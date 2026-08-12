import React, {
  cloneElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Camera,
  FileText,
  Mic,
  Paperclip,
  Phone,
  PhoneOff,
  Send,
  Settings,
  Trash2,
  Users,
  Video,
  X,
} from "@/components/icons";
import type {
  PhoneCallKind,
  PhoneCallOutcome,
  PhoneConversationSummary,
  PhoneEvent,
  PhoneMessage,
  PhoneState,
} from "./types";
import { mergeMessages } from "./domain";

type CallState = "idle" | "inviting" | "ringing" | "connecting" | "connected";

export function PhonePanel(): JSX.Element {
  const [state, setState] = useState<PhoneState>();
  const [selectedId, setSelectedId] = useState<string>();
  const [messages, setMessages] = useState<PhoneMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [callState, setCallState] = useState<CallState>("idle");
  const [callId, setCallId] = useState<string>();
  const [callKind, setCallKind] = useState<PhoneCallKind>("audio");
  const [incoming, setIncoming] = useState<{
    callId: string;
    peerId: string;
    kind: PhoneCallKind;
  }>();
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [transfers, setTransfers] = useState<
    Record<
      string,
      {
        name: string;
        transferred: number;
        total: number;
        status: string;
        direction: string;
      }
    >
  >({});
  const [conversations, setConversations] = useState<
    PhoneConversationSummary[]
  >([]);
  const [mediaDevices, setMediaDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioInput, setAudioInput] = useState("");
  const [videoInput, setVideoInput] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [showPeer, setShowPeer] = useState(false);
  const [nickname, setNickname] = useState("");
  const [avatar, setAvatar] = useState<string>();
  const [remark, setRemark] = useState("");
  const pcRef = useRef<RTCPeerConnection>();
  const localStreamRef = useRef<MediaStream>();
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const selectedRef = useRef<string>();
  const callMetaRef = useRef<{
    callId: string;
    peerId: string;
    kind: PhoneCallKind;
    direction: "incoming" | "outgoing";
    connectedAt?: number;
    recorded?: boolean;
  }>();
  const peer = state?.peers.find((item) => item.id === selectedId);
  selectedRef.current = selectedId;

  const refresh = useCallback(async () => {
    const next = await window.electronAPI.phone.start();
    setState(next);
    setNickname(next.nickname);
    setAvatar(next.avatar);
    setConversations(await window.electronAPI.phone.listConversations());
  }, []);
  const loadMessages = useCallback(
    async (peerId: string) => {
      const items = await window.electronAPI.phone.listMessages(peerId);
      setMessages(items);
      const unread = items
        .filter(
          (item) =>
            item.recipientId === (state?.deviceId ?? "") &&
            item.status !== "read",
        )
        .map((item) => item.id);
      if (unread.length)
        await window.electronAPI.phone.markRead(peerId, unread);
    },
    [state?.deviceId],
  );
  const endCall = useCallback(
    (notify = true, outcome: PhoneCallOutcome = "completed") => {
      const meta = callMetaRef.current;
      if (notify && callId && selectedRef.current)
        void window.electronAPI.phone.sendSignal(selectedRef.current, {
          type: "call.hangup",
          callId,
          peerId: selectedRef.current,
        });
      if (meta && !meta.recorded) {
        meta.recorded = true;
        void window.electronAPI.phone
          .recordCall({
            callId: meta.callId,
            peerId: meta.peerId,
            kind: meta.kind,
            direction: meta.direction,
            outcome,
            durationMs: meta.connectedAt
              ? Date.now() - meta.connectedAt
              : undefined,
          })
          .then((message) => {
            if (message.peerId === selectedRef.current)
              setMessages((items) => mergeMessages(items, [message]));
            void refresh();
          });
      }
      pcRef.current?.close();
      pcRef.current = undefined;
      for (const track of localStreamRef.current?.getTracks() ?? [])
        track.stop();
      localStreamRef.current = undefined;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      pendingIce.current = [];
      setCallState("idle");
      setCallId(undefined);
      setIncoming(undefined);
      setMuted(false);
      setCameraOff(false);
    },
    [callId, refresh],
  );

  const createPeerConnection = useCallback(
    (peerId: string, activeCallId: string) => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.onicecandidate = (event) => {
        if (event.candidate)
          void window.electronAPI.phone.sendSignal(peerId, {
            type: "webrtc.ice",
            callId: activeCallId,
            peerId,
            candidate: event.candidate.toJSON(),
          });
      };
      pc.ontrack = (event) => {
        if (remoteVideoRef.current)
          remoteVideoRef.current.srcObject = event.streams[0];
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          if (callMetaRef.current)
            callMetaRef.current.connectedAt ??= Date.now();
          setCallState("connected");
        }
        if (pc.connectionState === "failed") endCall(false, "failed");
      };
      pcRef.current = pc;
      return pc;
    },
    [endCall],
  );
  const acquireMedia = useCallback(
    async (kind: PhoneCallKind) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioInput ? { deviceId: { exact: audioInput } } : true,
        video:
          kind === "video"
            ? videoInput
              ? { deviceId: { exact: videoInput } }
              : true
            : false,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setMediaDevices(await navigator.mediaDevices.enumerateDevices());
      return stream;
    },
    [audioInput, videoInput],
  );
  const makeOffer = useCallback(
    async (peerId: string, activeCallId: string, kind: PhoneCallKind) => {
      const pc = createPeerConnection(peerId, activeCallId);
      const stream = await acquireMedia(kind);
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await window.electronAPI.phone.sendSignal(peerId, {
        type: "webrtc.offer",
        callId: activeCallId,
        peerId,
        sdp: offer.sdp ?? "",
      });
    },
    [acquireMedia, createPeerConnection],
  );

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
    return window.electronAPI.phone.onEvent((event: PhoneEvent) => {
      if (event.type === "file.progress") {
        setTransfers((items) => ({
          ...items,
          [event.fileId]: {
            name: event.name,
            transferred: event.transferred,
            total: event.total,
            status: event.status,
            direction: event.direction,
          },
        }));
        return;
      }
      if (event.type === "pair.request") {
        window.alert(
          `${event.peer.nickname || event.peer.name} 请求与本机配对。\n\n配对验证码：${event.code.slice(0, 3)} ${event.code.slice(3)}\n\n请与对方核对一致后接受。`,
        );
      }
      if (event.type === "pair.result") {
        window.alert(
          event.accepted
            ? `配对成功，验证码：${event.code.slice(0, 3)} ${event.code.slice(3)}`
            : "对方拒绝了配对请求",
        );
        void refresh();
      }
      if (event.type === "state") setState(event.state);
      else if (event.type === "peer.updated")
        setState((value) =>
          value
            ? {
                ...value,
                peers: [
                  ...value.peers.filter((item) => item.id !== event.peer.id),
                  event.peer,
                ],
              }
            : value,
        );
      else if (event.type === "pair.request") {
        if (
          window.confirm(
            `${event.peer.name} 请求与本机配对，是否接受？\n指纹：${event.peer.fingerprint}`,
          )
        )
          void window.electronAPI.phone.respondPairing(
            event.requestId,
            event.peer.id,
            true,
          );
        else
          void window.electronAPI.phone.respondPairing(
            event.requestId,
            event.peer.id,
            false,
          );
      } else if (event.type === "pair.result") void refresh();
      else if (
        event.type === "message" &&
        event.message.peerId === selectedRef.current
      )
        setMessages((items) => mergeMessages(items, [event.message]));
      else if (event.type === "message.status")
        setMessages((items) =>
          items.map((item) =>
            item.id === event.messageId
              ? { ...item, status: event.status }
              : item,
          ),
        );
      else if (event.type === "call.invite") {
        if (callState !== "idle")
          void window.electronAPI.phone.sendSignal(event.peerId, {
            type: "call.busy",
            callId: event.callId,
            peerId: event.peerId,
          });
        else {
          setSelectedId(event.peerId);
          setIncoming({
            callId: event.callId,
            peerId: event.peerId,
            kind: event.kind,
          });
          setCallId(event.callId);
          setCallKind(event.kind);
          setCallState("ringing");
          void window.electronAPI.phone.sendSignal(event.peerId, {
            type: "call.ringing",
            callId: event.callId,
            peerId: event.peerId,
          });
        }
      } else if (event.type === "call.accept") {
        setCallState("connecting");
        void makeOffer(event.peerId, event.callId, callKind);
      } else if (
        ["call.reject", "call.cancel", "call.busy", "call.hangup"].includes(
          event.type,
        )
      )
        endCall(false);
      else if (event.type === "webrtc.offer") {
        void (async () => {
          const pc =
            pcRef.current ?? createPeerConnection(event.peerId, event.callId);
          if (!localStreamRef.current) {
            const stream = await acquireMedia(callKind);
            for (const track of stream.getTracks()) pc.addTrack(track, stream);
          }
          await pc.setRemoteDescription({ type: "offer", sdp: event.sdp });
          for (const candidate of pendingIce.current.splice(0))
            await pc.addIceCandidate(candidate);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await window.electronAPI.phone.sendSignal(event.peerId, {
            type: "webrtc.answer",
            callId: event.callId,
            peerId: event.peerId,
            sdp: answer.sdp ?? "",
          });
        })();
      } else if (event.type === "webrtc.answer")
        void (async () => {
          await pcRef.current?.setRemoteDescription({
            type: "answer",
            sdp: event.sdp,
          });
          for (const candidate of pendingIce.current.splice(0))
            await pcRef.current?.addIceCandidate(candidate);
        })();
      else if (event.type === "webrtc.ice") {
        if (pcRef.current?.remoteDescription)
          void pcRef.current.addIceCandidate(event.candidate);
        else pendingIce.current.push(event.candidate);
      }
    });
  }, [
    acquireMedia,
    callKind,
    callState,
    createPeerConnection,
    endCall,
    makeOffer,
    refresh,
  ]);
  useEffect(() => {
    if (selectedId) void loadMessages(selectedId);
    else setMessages([]);
  }, [loadMessages, selectedId]);
  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then(setMediaDevices)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (callState !== "inviting" || !callId) return;
    const timer = window.setTimeout(() => {
      if (selectedRef.current)
        void window.electronAPI.phone.sendSignal(selectedRef.current, {
          type: "call.cancel",
          callId,
          peerId: selectedRef.current,
        });
      setError("对方无人接听");
      endCall(false);
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [callId, callState, endCall]);

  const sendText = async () => {
    if (!peer) return;
    try {
      const message = await window.electronAPI.phone.sendText(peer.id, text);
      setMessages((items) => mergeMessages(items, [message]));
      setText("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const requestPairing = async () => {
    if (!peer) return;
    try {
      const result = await window.electronAPI.phone.pair(peer.id);
      window.alert(
        `请与对方核对相同的配对验证码：\n\n${result.code.slice(0, 3)} ${result.code.slice(3)}`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const startCall = async (kind: PhoneCallKind) => {
    if (!peer?.trusted || peer.status !== "online") return;
    const id = crypto.randomUUID();
    callMetaRef.current = {
      callId: id,
      peerId: peer.id,
      kind,
      direction: "outgoing",
    };
    setCallId(id);
    setCallKind(kind);
    setCallState("inviting");
    await window.electronAPI.phone.sendSignal(peer.id, {
      type: "call.invite",
      callId: id,
      peerId: peer.id,
      kind,
    });
  };
  const acceptCall = async () => {
    if (!incoming) return;
    callMetaRef.current = {
      callId: incoming.callId,
      peerId: incoming.peerId,
      kind: incoming.kind,
      direction: "incoming",
    };
    setCallState("connecting");
    await window.electronAPI.phone.sendSignal(incoming.peerId, {
      type: "call.accept",
      callId: incoming.callId,
      peerId: incoming.peerId,
    });
  };

  const activeTransfers = Object.entries(transfers).filter(
    ([, transfer]) => transfer.status === "transferring",
  );
  const callSummary = messages
    .filter((message) => message.kind === "call")
    .at(-1)?.call;
  return (
    <div className="relative flex h-full min-h-0 bg-background text-foreground">
      <button
        title="个人资料"
        onClick={() => setShowProfile(true)}
        className="absolute left-56 top-3 z-30"
      >
        <Settings className="h-4 w-4 text-muted-foreground" />
      </button>
      {conversations.reduce((sum, item) => sum + item.unreadCount, 0) > 0 && (
        <span className="absolute left-48 top-3 z-20 rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
          {conversations.reduce((sum, item) => sum + item.unreadCount, 0)} 未读
        </span>
      )}
      {peer && callSummary && (
        <div className="absolute right-5 top-20 z-20 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow">
          <Phone className="mr-1 inline h-3.5 w-3.5" />
          最近{callSummary.direction === "incoming" ? "来电" : "呼出"}：
          {formatCallOutcome(callSummary.outcome)}
          {callSummary.durationMs
            ? ` · ${formatDuration(callSummary.durationMs)}`
            : ""}
        </div>
      )}
      {showProfile && (
        <Dialog title="个人资料" onClose={() => setShowProfile(false)}>
          <Avatar value={avatar} name={nickname || "P"} large />
          <label className="block text-xs text-muted-foreground">
            用户昵称
          </label>
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <label className="mt-3 block text-xs text-muted-foreground">
            头像
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file || file.size > 200_000) {
                setError("头像请选择小于 200 KB 的图片");
                return;
              }
              const reader = new FileReader();
              reader.onload = () => setAvatar(String(reader.result));
              reader.readAsDataURL(file);
            }}
            className="w-full text-xs"
          />
          <button
            onClick={() =>
              void window.electronAPI.phone
                .updateProfile({ nickname, avatar })
                .then((next) => {
                  setState(next);
                  setShowProfile(false);
                })
            }
            className="mt-4 w-full rounded-lg bg-primary py-2 text-sm text-primary-foreground"
          >
            保存资料
          </button>
        </Dialog>
      )}
      {showPeer && peer && (
        <Dialog title="可信设备详情" onClose={() => setShowPeer(false)}>
          <Avatar
            value={peer.avatar}
            name={peer.remark || peer.nickname || peer.name}
            large
          />
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">昵称</dt>
              <dd>{peer.nickname || peer.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">设备地址</dt>
              <dd>
                {peer.host}:{peer.port}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">设备指纹</dt>
              <dd className="break-all font-mono">{peer.fingerprint}</dd>
            </div>
          </dl>
          <label className="mt-3 block text-xs text-muted-foreground">
            设备备注
          </label>
          <input
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            placeholder="例如：张三的办公室电脑"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="mt-4 flex gap-2">
            <button
              onClick={() =>
                void window.electronAPI.phone
                  .updatePeer(peer.id, { remark })
                  .then(() => {
                    setShowPeer(false);
                    void refresh();
                  })
              }
              className="flex-1 rounded-lg bg-primary py-2 text-sm text-primary-foreground"
            >
              保存备注
            </button>
            <button
              onClick={() => {
                if (window.confirm("确定解除配对？"))
                  void window.electronAPI.phone.removePeer(peer.id).then(() => {
                    setShowPeer(false);
                    void refresh();
                  });
              }}
              className="rounded-lg bg-destructive px-3 text-destructive-foreground"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </Dialog>
      )}
      {callState !== "idle" && (
        <div className="fixed left-1/2 top-6 z-[1700] flex -translate-x-1/2 gap-2">
          <select
            aria-label="麦克风"
            value={audioInput}
            onChange={(event) => setAudioInput(event.target.value)}
            className="max-w-48 rounded-lg border border-white/20 bg-black/70 px-2 py-1.5 text-xs text-white"
          >
            <option value="">默认麦克风</option>
            {mediaDevices
              .filter((item) => item.kind === "audioinput")
              .map((item) => (
                <option key={item.deviceId} value={item.deviceId}>
                  {item.label || "麦克风"}
                </option>
              ))}
          </select>
          {callKind === "video" && (
            <select
              aria-label="摄像头"
              value={videoInput}
              onChange={(event) => setVideoInput(event.target.value)}
              className="max-w-48 rounded-lg border border-white/20 bg-black/70 px-2 py-1.5 text-xs text-white"
            >
              <option value="">默认摄像头</option>
              {mediaDevices
                .filter((item) => item.kind === "videoinput")
                .map((item) => (
                  <option key={item.deviceId} value={item.deviceId}>
                    {item.label || "摄像头"}
                  </option>
                ))}
            </select>
          )}
        </div>
      )}
      {activeTransfers.length > 0 && (
        <div className="absolute bottom-20 right-5 z-50 w-72 rounded-xl border border-border bg-card p-3 shadow-xl">
          {activeTransfers.map(([fileId, transfer]) => (
            <div key={fileId} className="mb-2 last:mb-0">
              <div className="flex justify-between text-xs">
                <span className="max-w-44 truncate">
                  {transfer.direction === "send" ? "发送" : "接收"}：
                  {transfer.name}
                </span>
                <span>
                  {Math.round(
                    (transfer.transferred / Math.max(1, transfer.total)) * 100,
                  )}
                  %{" "}
                  {transfer.direction === "send" && (
                    <button
                      className="ml-1 text-destructive"
                      onClick={() =>
                        void window.electronAPI.phone.cancelFile(fileId)
                      }
                    >
                      取消
                    </button>
                  )}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary"
                  style={{
                    width: `${(transfer.transferred / Math.max(1, transfer.total)) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card/60">
        <header className="border-b border-border p-4">
          <div className="flex items-center gap-2 text-base font-semibold">
            <Avatar value={state?.avatar} name={state?.nickname || "Phone"} />
            <span className="min-w-0">
              <span className="block truncate">
                {state?.nickname || "Phone"}
              </span>
              <span className="block text-[10px] font-normal text-muted-foreground">
                Phone
              </span>
            </span>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {state?.deviceName ?? "正在启动…"} ·{" "}
            {state?.ready ? `端口 ${state.port}` : "离线"}
          </div>
        </header>
        <div className="flex-1 overflow-auto p-2">
          <div className="px-2 py-2 text-[11px] font-semibold uppercase text-muted-foreground">
            局域网设备
          </div>
          {state?.peers.length ? (
            state.peers.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${selectedId === item.id ? "bg-primary/10 text-primary" : "hover:bg-accent"}`}
              >
                <span className="relative grid h-9 w-9 place-items-center rounded-full bg-muted">
                  <Users className="h-4 w-4" />
                  <i
                    className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card ${item.status === "online" ? "bg-emerald-500" : "bg-zinc-400"}`}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{item.name}</b>
                  <small className="text-[11px] text-muted-foreground">
                    {item.trusted
                      ? item.status === "online"
                        ? "在线"
                        : "离线"
                      : "等待配对"}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">
              正在发现局域网中的 Phone…
            </div>
          )}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {peer ? (
          <>
            <header className="flex h-16 items-center justify-between border-b border-border px-5">
              <div>
                <div className="font-semibold">
                  {peer.remark || peer.nickname || peer.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {peer.host}:{peer.port} ·{" "}
                  {peer.trusted ? peer.status : "未配对"}
                </div>
              </div>
              <div className="flex gap-2">
                {!peer.trusted ? (
                  <button
                    className="rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground"
                    onClick={() => void requestPairing()}
                  >
                    请求配对
                  </button>
                ) : (
                  <>
                    <IconButton
                      title="设备详情"
                      onClick={() => {
                        setRemark(peer.remark ?? "");
                        setShowPeer(true);
                      }}
                    >
                      <Settings />
                    </IconButton>
                    <IconButton
                      title="语音通话"
                      onClick={() => void startCall("audio")}
                    >
                      <Phone />
                    </IconButton>
                    <IconButton
                      title="视频通话"
                      onClick={() => void startCall("video")}
                    >
                      <Video />
                    </IconButton>
                  </>
                )}
              </div>
            </header>
            <section className="flex-1 space-y-3 overflow-auto p-5">
              {messages.map((message) => {
                const mine = message.senderId === state?.deviceId;
                return (
                  <div
                    key={message.id}
                    className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[72%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "border border-border bg-card"}`}
                    >
                      {message.kind === "text" ? (
                        <div className="whitespace-pre-wrap break-words">
                          {message.text}
                        </div>
                      ) : (
                        <button
                          className="flex items-center gap-2"
                          onClick={() =>
                            void window.electronAPI.phone.openFile(message.id)
                          }
                        >
                          <FileText className="h-5 w-5" />
                          <span className="text-left">
                            <b className="block max-w-80 truncate">
                              {message.file?.name}
                            </b>
                            <small>
                              {formatBytes(message.file?.size ?? 0)}
                            </small>
                          </span>
                        </button>
                      )}
                      <div
                        className={`mt-1 text-right text-[10px] ${mine ? "text-primary-foreground/65" : "text-muted-foreground"}`}
                      >
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {mine ? ` · ${message.status}` : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
            <footer className="border-t border-border p-4">
              <div className="flex items-end gap-2">
                <IconButton
                  title="发送文件"
                  onClick={() =>
                    void window.electronAPI.phone
                      .selectAndSendFiles(peer.id)
                      .then((items) =>
                        setMessages((current) => mergeMessages(current, items)),
                      )
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  <Paperclip />
                </IconButton>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendText();
                    }
                  }}
                  placeholder={
                    peer.trusted ? "输入消息，Enter 发送" : "配对后即可聊天"
                  }
                  disabled={!peer.trusted}
                  className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
                <IconButton title="发送" onClick={() => void sendText()}>
                  <Send />
                </IconButton>
              </div>
              {error && (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                  <button onClick={() => setError("")}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </footer>
          </>
        ) : (
          <div className="grid h-full place-items-center text-center text-muted-foreground">
            <div>
              <Phone className="mx-auto mb-3 h-12 w-12 opacity-20" />
              <p>选择一台局域网设备开始通信</p>
            </div>
          </div>
        )}
      </main>
      {callState !== "idle" && (
        <div className="fixed inset-0 z-[1600] grid place-items-center bg-black/75 p-6">
          <div className="relative w-full max-w-4xl overflow-hidden rounded-2xl bg-zinc-950 text-white shadow-2xl">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="aspect-video w-full object-cover"
            />
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="absolute right-4 top-4 aspect-video w-44 rounded-xl border border-white/20 bg-black object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 p-5 text-center">
              <div className="mb-4">
                <b>{peer?.name}</b>
                <div className="text-xs text-white/60">
                  {callState === "ringing"
                    ? "来电"
                    : callState === "inviting"
                      ? "等待对方接听…"
                      : callState === "connecting"
                        ? "正在连接…"
                        : "通话中"}
                </div>
              </div>
              <div className="flex justify-center gap-3">
                {incoming && callState === "ringing" ? (
                  <>
                    <CallButton green onClick={() => void acceptCall()}>
                      <Phone />
                    </CallButton>
                    <CallButton
                      onClick={() => {
                        void window.electronAPI.phone.sendSignal(
                          incoming.peerId,
                          {
                            type: "call.reject",
                            callId: incoming.callId,
                            peerId: incoming.peerId,
                          },
                        );
                        endCall(false);
                      }}
                    >
                      <PhoneOff />
                    </CallButton>
                  </>
                ) : (
                  <>
                    <CallButton
                      active={muted}
                      onClick={() => {
                        const next = !muted;
                        localStreamRef.current
                          ?.getAudioTracks()
                          .forEach((track) => {
                            track.enabled = !next;
                          });
                        setMuted(next);
                      }}
                    >
                      <Mic />
                    </CallButton>
                    {callKind === "video" && (
                      <CallButton
                        active={cameraOff}
                        onClick={() => {
                          const next = !cameraOff;
                          localStreamRef.current
                            ?.getVideoTracks()
                            .forEach((track) => {
                              track.enabled = !next;
                            });
                          setCameraOff(next);
                        }}
                      >
                        <Camera />
                      </CallButton>
                    )}
                    <CallButton onClick={() => endCall()}>
                      <PhoneOff />
                    </CallButton>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactElement;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-card transition hover:bg-accent"
    >
      {cloneElement(children, {
        className: "h-4 w-4",
      } as React.HTMLAttributes<HTMLElement>)}
    </button>
  );
}
function CallButton({
  onClick,
  children,
  green,
  active,
}: {
  onClick: () => void;
  children: React.ReactElement;
  green?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`grid h-12 w-12 place-items-center rounded-full ${green ? "bg-emerald-500" : active ? "bg-white text-black" : "bg-red-500"}`}
    >
      {cloneElement(children, {
        className: "h-5 w-5",
      } as React.HTMLAttributes<HTMLElement>)}
    </button>
  );
}
function Avatar({
  value,
  name,
  large = false,
}: {
  value?: string;
  name: string;
  large?: boolean;
}) {
  const size = large ? "mx-auto mb-4 h-20 w-20 text-2xl" : "h-9 w-9 text-sm";
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 font-semibold text-primary ${size}`}
    >
      {value ? (
        <img src={value} alt="" className="h-full w-full object-cover" />
      ) : (
        name.trim().slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[1800] grid place-items-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button title="关闭" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
}
function formatCallOutcome(outcome?: PhoneCallOutcome): string {
  return (
    {
      completed: "已结束",
      rejected: "已拒绝",
      cancelled: "已取消",
      busy: "忙线",
      timeout: "无人接听",
      failed: "连接失败",
      "remote-hangup": "对方挂断",
    } as Record<PhoneCallOutcome, string>
  )[outcome ?? "completed"];
}
function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
