# R8 / ProGuard — release minify is on (Play DEX obfuscation threshold).

# WebView JS bridges are invoked by name from injected scripts.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Sentry — keep line numbers for readable crash stacks when mapping upload is off.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
