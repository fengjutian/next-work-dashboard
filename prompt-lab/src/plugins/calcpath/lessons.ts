export interface LessonContent {
  id: string; title: string; stage: string; question: string; insight: string; prerequisites: string[];
  concepts: { title: string; body: string; formula?: string }[];
  example: { question: string; steps: string[]; answer: string };
  next: string[];
  exposition?: { heading: string; paragraphs: string[]; definition?: string; formula?: string; caution?: string }[];
}

export const LESSONS: Record<string, LessonContent> = {
  algebra: { id: 'algebra', title: '代数运算', stage: '高中数学地基', question: '为什么极限题经常先考你的代数？', insight: '极限中的 0/0 通常不是答案，而是提醒你：表达式需要先变形。', prerequisites: ['数与式', '乘法公式'], concepts: [{ title: '平方差', body: '两个平方相减可以拆成一对共轭因式。', formula: 'a² − b² = (a − b)(a + b)' }, { title: '等价变形', body: '在允许的定义域内改变形式，但不改变表达式的值。' }], example: { question: '化简 (x²−4)/(x−2)，x≠2', steps: ['识别 x²−4 是平方差', '分解为 (x−2)(x+2)', '约去公共因子 x−2'], answer: 'x + 2' }, next: ['无限趋近', '极限与连续'] },
  functions: { id: 'functions', title: '函数语言', stage: '高中数学地基', question: '微积分究竟在研究什么？', insight: '函数不是一个算式，而是一台描述“一个量如何随另一个量变化”的机器。', prerequisites: ['集合与对应', '坐标系'], concepts: [{ title: '输入与输出', body: '定义域规定允许输入什么，函数值描述对应的输出。', formula: 'x ↦ f(x)' }, { title: '复合函数', body: '一个变化过程的输出，可以成为另一个过程的输入。', formula: '(f∘g)(x)=f(g(x))' }], example: { question: 'f(x)=2x+3，输入 4 时发生了什么？', steps: ['把 4 送入函数机器', '先乘 2 得到 8', '再加 3'], answer: 'f(4)=11' }, next: ['无限趋近', '变化率', '导数'] },
  graphs: { id: 'graphs', title: '图像直觉', stage: '高中数学地基', question: '一张图像能告诉我们哪些变化？', insight: '图像把函数的整体趋势、局部陡峭程度和趋近行为同时呈现出来。', prerequisites: ['坐标系', '函数语言'], concepts: [{ title: '平移与伸缩', body: '参数变化会以可预测的方式移动或拉伸图像。' }, { title: '局部观察', body: '不断放大一条光滑曲线，它在局部会越来越像直线。' }], example: { question: '比较 y=x² 在 x=1 与 x=3 附近的陡峭程度', steps: ['观察相同水平步长', '比较对应的竖直变化', 'x=3 附近变化更快'], answer: 'x=3 附近更陡' }, next: ['变化率', '极限与连续'] },
  trig: { id: 'trig', title: '三角 · 指对数', stage: '高中数学地基', question: '为什么大学微积分总离不开这些函数？', insight: '周期变化、指数增长和对数尺度是自然与工程问题最常见的三类模型。', prerequisites: ['函数语言', '单位圆'], concepts: [{ title: '周期变化', body: 'sin 与 cos 描述重复出现的变化。' }, { title: '增长与反函数', body: '指数描述按比例增长，对数回答增长了多少个数量级。' }], example: { question: '人口每期增长 5%，适合哪类函数？', steps: ['每期乘以固定比例 1.05', '连续相乘形成指数结构'], answer: '指数函数' }, next: ['变化率', '导数', '微分方程'] },
  approach: { id: 'approach', title: '无限趋近', stage: '思维桥梁', question: '不能直接到达，也能确定结果吗？', insight: '极限关心的是靠近某点时的稳定趋势，而不一定是那个点本身的取值。', prerequisites: ['函数语言', '图像直觉', '代数运算'], concepts: [{ title: '趋近过程', body: '从左右两侧不断缩短距离，观察输出是否靠近同一个数。' }, { title: '可去间断点', body: '点上没有定义，并不妨碍附近存在稳定趋势。' }], example: { question: 'x 趋近 2 时，(x²−4)/(x−2) 趋近多少？', steps: ['先化简为 x+2', '让 x 越来越接近 2', '输出越来越接近 4'], answer: '4' }, next: ['极限与连续'] },
  rate: { id: 'rate', title: '变化率', stage: '思维桥梁', question: '平均速度如何变成某一瞬间的速度？', insight: '不断缩短时间区间，平均变化率会逼近瞬时变化率。', prerequisites: ['函数语言', '斜率', '无限趋近'], concepts: [{ title: '平均变化率', body: '用一段区间的输出变化除以输入变化。', formula: 'Δy / Δx' }, { title: '瞬时变化率', body: '让区间长度趋近于零，得到某一点的局部变化。' }], example: { question: '位置 s(t)=t²，从 t=2 到 t=2+h 的平均速度', steps: ['计算 [s(2+h)−s(2)]/h', '展开并化简为 4+h', '令 h 趋近 0'], answer: '瞬时速度为 4' }, next: ['极限与连续', '导数'] },
  limits: { id: 'limits', title: '极限与连续', stage: '微积分核心', question: '如何严格描述“越来越接近”？', insight: '极限为瞬时变化和无限累积提供共同语言，是微积分的逻辑入口。', prerequisites: ['无限趋近', '函数语言', '代数运算'], concepts: [{ title: '函数极限', body: '输入靠近目标时，输出可以稳定靠近某个值。', formula: 'limₓ→ₐ f(x)=L' }, { title: '连续', body: '极限存在、函数值存在，并且二者相等。' }], example: { question: '判断 f(x)=x² 在 x=2 是否连续', steps: ['函数在 2 有定义', '极限为 4', '函数值 f(2)=4'], answer: '连续' }, next: ['导数', '级数与 Taylor'] },
  derivatives: { id: 'derivatives', title: '导数', stage: '微积分核心', question: '如何测量一个瞬间的变化？', insight: '导数统一了切线斜率、瞬时速度、边际成本和优化条件。', prerequisites: ['极限与连续', '变化率', '函数图像'], concepts: [{ title: '导数定义', body: '差商在区间长度趋近零时的极限。', formula: "f′(x)=limₕ→₀ [f(x+h)−f(x)]/h" }, { title: '局部线性', body: '光滑函数在足够小的范围内可以用切线近似。' }], example: { question: '用幂法则求 f(x)=x³ 的导数', steps: ['指数 3 移到系数', '原指数减 1'], answer: 'f′(x)=3x²' }, next: ['积分', '多元微积分', '微分方程'] },
  integrals: { id: 'integrals', title: '积分', stage: '微积分核心', question: '无数个微小量如何组成一个整体？', insight: '积分把连续累积转化为可计算的极限，并通过基本定理与导数互相连接。', prerequisites: ['导数', '面积', '求和'], concepts: [{ title: '黎曼和', body: '把区域切成许多窄条，面积和在宽度趋近零时形成积分。' }, { title: '微积分基本定理', body: '求导与积分在适当条件下互为逆运算。', formula: '∫ₐᵇ f(x)dx = F(b)−F(a)' }], example: { question: '求 ∫2x dx', steps: ['寻找导数等于 2x 的函数', 'x² 的导数是 2x', '补上积分常数'], answer: 'x²+C' }, next: ['微分方程', '概率', '多元积分'] },
};

const future = (id: string, title: string, question: string, prerequisites: string[]) => ({ id, title, stage: '大学数学方向', question, insight: '这里是当前微积分路径继续生长的方向。完成前置能力后，CalcPath 会展开为可学习的完整课程。', prerequisites, concepts: [{ title: '学习目标', body: question }, { title: '前置路线', body: prerequisites.join(' → ') }], example: { question: '当前阶段', steps: ['建立高中数学地基', '跨过极限与变化率桥梁', '掌握导数与积分'], answer: '完成前置路径后解锁' }, next: [] });
LESSONS.multivariable = future('multivariable', '多元微积分', '当输出同时受多个变量影响时，如何描述变化？', ['导数', '向量']);
LESSONS.diffeq = future('diffeq', '微分方程', '已知变化规律，如何反推出系统随时间的状态？', ['导数', '积分']);
LESSONS.series = future('series', '级数与 Taylor', '如何用无限多项式逼近复杂函数？', ['极限', '高阶导数']);
LESSONS.linear = future('linear', '线代 · 概率', '微积分如何进入高维空间和随机世界？', ['积分', '向量与矩阵']);

LESSONS.functions.exposition = [
  { heading: '1. 从变化量开始', paragraphs: ['现实问题通常包含两个或更多互相依赖的量。圆的面积依赖半径，物体的位置依赖时间，生产成本依赖产量。微积分首先需要一种语言，把这种依赖关系写清楚。', '函数把每个允许的输入对应到唯一输出。这里的重点不是“代入算数”，而是辨认谁在变化、谁由谁决定，以及输入能取哪些值。'], definition: '若集合 D 中每个元素 x 都恰好对应集合中的一个值 f(x)，就称 f 是定义在 D 上的函数。D 称为定义域。' },
  { heading: '2. 四种观察函数的方式', paragraphs: ['同一个函数可以用语言、数表、图像和公式表示。公式适合计算；图像适合观察趋势、极值和局部变化；数表适合实验数据；语言帮助我们识别变量之间的意义。', '学习微积分时，要能够在四种表示之间转换。只会操纵公式，却无法从图像说明“函数正在怎样变化”，会直接影响极限和导数的理解。'], caution: '图像上的一个点表示一对输入与输出，不表示函数只由这些离散点组成。' },
  { heading: '3. 复合函数是连续的过程', paragraphs: ['许多现实变化由多个步骤串联。例如温度影响电阻，电阻又影响电流。复合函数把前一过程的输出作为后一过程的输入。', '链式法则之所以出现，并不是人为规定了一条求导技巧，而是因为多层变化会逐层传播。'], formula: '(f ∘ g)(x) = f(g(x))' },
];
LESSONS.approach.exposition = [
  { heading: '1. 为什么需要极限思想', paragraphs: ['瞬时速度要求时间间隔为零，但“位移除以零”没有意义；曲线切线只接触一个点，却不能用一个点计算斜率。解决方法不是直接令间隔等于零，而是研究间隔不断缩小时，平均量趋向什么。', '这一步把问题从“在点上发生什么”改写成“在点附近呈现什么稳定趋势”。这就是极限思想。'] },
  { heading: '2. 点上的值和附近的趋势', paragraphs: ['函数在 x=a 处是否有定义，与 x 趋近 a 时是否存在极限，是两个不同问题。极限有意忽略目标点本身，只观察任意接近它但不等于它的输入。', '因此，一个图像即使在目标点有空洞，附近曲线仍可能从两侧靠近同一高度。'], definition: '当 x 可以充分接近 a（但不要求等于 a）时，f(x) 可以任意接近 L，就写作 limₓ→ₐ f(x)=L。' },
  { heading: '3. 左极限与右极限', paragraphs: ['输入可以从小于 a 的一侧靠近，也可以从大于 a 的一侧靠近。只有两侧输出趋向同一个数，双侧极限才存在。', '这一条件在分段函数、绝对值函数和跳跃现象中尤其重要。'], formula: 'limₓ→ₐ f(x)=L ⇔ limₓ→ₐ⁻ f(x)=limₓ→ₐ⁺ f(x)=L', caution: '“函数值很大”不等于极限不存在；关键是它是否趋向同一个确定目标。' },
];
LESSONS.limits.exposition = [
  { heading: '1. 用数值和图像估计极限', paragraphs: ['可以先从 a 左右选取越来越接近的输入，制作数表并观察输出。图像则帮助判断左右趋势是否一致。这些方法建立直觉，但不能代替证明。', '数表可能因为取点不足而误导，绘图软件也可能隐藏空洞或剧烈振荡。因此我们还需要极限定律和代数方法。'] },
  { heading: '2. 极限定律', paragraphs: ['如果两个函数的极限分别存在，那么和、差、积的极限可以分别计算后再组合；商也可以这样处理，但分母的极限不能为零。', '这些规则说明极限与普通代数运算具有良好兼容性，也解释了为什么连续函数通常可以直接代入。'], formula: 'lim(f·g)=(lim f)(lim g)，lim(f/g)=(lim f)/(lim g)，其中 lim g ≠ 0' },
  { heading: '3. 连续性的三个条件', paragraphs: ['函数在 a 连续，需要同时满足：f(a) 有定义；limₓ→ₐ f(x) 存在；这个极限等于 f(a)。任何一项失败都会产生间断。', '连续性把“附近的趋势”和“点上的实际值”接合起来。多项式在所有实数上连续，有理函数在分母不为零处连续。'], definition: 'f 在 a 连续，当且仅当 limₓ→ₐ f(x)=f(a)。', caution: '能直接代入只是连续性的结果，不是所有极限题都可以直接代入。' },
];
LESSONS.derivatives.exposition = [
  { heading: '1. 从平均变化率到瞬时变化率', paragraphs: ['设 y=f(x)。从 x 到 x+h 的平均变化率，是函数值变化量除以输入变化量。几何上，这是连接曲线上两点的割线斜率。', '让第二个点沿曲线靠近第一个点，也就是令 h 趋近 0。如果割线斜率趋向一个有限值，我们把它定义为该点的导数。'], formula: '[f(x+h)−f(x)] / h' },
  { heading: '2. 导数的定义', paragraphs: ['导数不是把 h 直接设成零。差商只在 h≠0 时有意义，我们先进行代数化简，再研究 h 趋近零的极限。', '同一个数同时表示切线斜率和瞬时变化率，这是微积分最重要的统一之一。'], definition: "f′(x)=limₕ→₀ [f(x+h)−f(x)]/h，前提是这个极限存在。" },
  { heading: '3. 可导与连续', paragraphs: ['如果函数在某点可导，那么它在该点一定连续。反过来不成立：绝对值函数在 0 连续，但图像有尖角，左右斜率不同，因此不可导。', '竖直切线、尖角、尖点和间断都可能导致导数不存在。'], caution: '连续不能保证可导；看到图像没有断开，还必须检查局部是否光滑且斜率有限。' },
  { heading: '4. 导数作为新的函数', paragraphs: ['对定义域中每个可导点求导，会得到导函数 f′。它记录原函数在每一点的变化方向和快慢。', 'f′>0 表示原函数局部递增，f′<0 表示局部递减，f′=0 是寻找极值的重要候选条件。'], formula: "位置 s(t) → 速度 v(t)=s′(t) → 加速度 a(t)=v′(t)" },
];
LESSONS.integrals.exposition = [
  { heading: '1. 累积问题', paragraphs: ['已知速度随时间变化，怎样求总位移？已知曲线高度，怎样求曲线下方面积？这些问题都要求把许多微小贡献累加起来。', '当每一小段的量并不恒定时，普通的“长乘宽”不再直接适用。我们把区间分割成许多小段，用矩形近似，再研究分割无限变细时的极限。'] },
  { heading: '2. 黎曼和', paragraphs: ['把 [a,b] 分成 n 个小区间，每段宽度为 Δx。在每段选取样本点 xᵢ*，用 f(xᵢ*)Δx 近似这一窄条的面积。', '所有矩形面积相加得到黎曼和。若最大分段宽度趋近零时这些和趋向同一数，就定义定积分存在。'], formula: '∫ₐᵇ f(x)dx = lim Σ f(xᵢ*)Δx' },
  { heading: '3. 定积分不是总是面积', paragraphs: ['位于 x 轴上方的部分贡献正值，下方部分贡献负值，所以定积分表示带符号的净累积。若要求几何总面积，需要按零点分段并对每部分取非负面积。'], caution: '∫ₐᵇ f(x)dx 可能为零，但这不代表图形没有面积；正负部分可能正好抵消。' },
  { heading: '4. 微积分基本定理', paragraphs: ['求导研究局部变化，积分研究整体累积。基本定理说明二者并不是分离的技术，而是互逆过程。', '如果 F′=f，那么计算定积分不必真的求无限多个矩形之和，只需计算原函数在端点的差。'], formula: '∫ₐᵇ f(x)dx = F(b)−F(a)' },
];
