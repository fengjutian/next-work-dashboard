# ProGuard rules for MyCast (release builds).
# flutter_webrtc ships its own consumer rules; this file is for the rest of
# the Kotlin code.

# Keep our media projection service class.
-keep class com.nextworkdashboard.mycast.capture.** { *; }

# Keep Flutter platform channel handlers.
-keepclassmembers class * implements io.flutter.plugin.common.MethodCallHandler {
    public *;
}
-keep class io.flutter.embedding.** { *; }
-keep class io.flutter.plugin.** { *; }

# Suppress noisy warnings from optional libraries we don't use directly.
-dontwarn javax.annotation.**
-dontwarn org.checkerframework.**
-dontwarn org.codehaus.mojo.animal_sniffer.IgnoreJRERequirement
