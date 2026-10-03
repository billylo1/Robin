import java.io.FileInputStream
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("io.sentry.android.gradle")
}

val localProperties = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

val keystoreProperties = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) FileInputStream(f).use { load(it) }
}

// Optional — empty / placeholder ⇒ Sentry disabled at runtime (safe for forks).
fun sanitizeSentryDsn(raw: String?): String {
    val dsn = (raw ?: "").trim()
    if (dsn.isEmpty()) return ""
    if (dsn.contains("YOUR_", ignoreCase = true)) return ""
    if (!dsn.startsWith("http://") && !dsn.startsWith("https://")) return ""
    return dsn
}

fun sanitizeAptabaseAppKey(raw: String?): String {
    val key = (raw ?: "").trim()
    if (key.isEmpty()) return ""
    if (key.contains("YOUR_", ignoreCase = true)) return ""
    if (!key.startsWith("A-", ignoreCase = true)) return ""
    return key
}

fun sanitizeAptabaseHost(raw: String?): String {
    val host = (raw ?: "").trim().trimEnd('/')
    if (host.isEmpty()) return ""
    if (host.contains("YOUR_", ignoreCase = true)) return ""
    if (!host.startsWith("http://") && !host.startsWith("https://")) return ""
    return host
}

fun escapeBuildConfigString(value: String): String =
    value.replace("\\", "\\\\").replace("\"", "\\\"")

val sentryDsnRaw: String =
    sanitizeSentryDsn(
        localProperties.getProperty("sentry.dsn") ?: System.getenv("SENTRY_DSN"),
    )
val sentryEnabled = sentryDsnRaw.isNotEmpty()
val sentryDsn: String = escapeBuildConfigString(sentryDsnRaw)

val aptabaseAppKey: String =
    escapeBuildConfigString(
        sanitizeAptabaseAppKey(
            localProperties.getProperty("aptabase.appKey")
                ?: System.getenv("APTABASE_APP_KEY"),
        ),
    )
val aptabaseHost: String =
    escapeBuildConfigString(
        sanitizeAptabaseHost(
            localProperties.getProperty("aptabase.host")
                ?: System.getenv("APTABASE_HOST"),
        ),
    )

android {
    namespace = "org.evergreenlabs.robin"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.evergreenlabs.robin"
        minSdk = 33
        targetSdk = 36
        versionCode = 42
        versionName = "0.2.15"
        buildConfigField("String", "SENTRY_DSN", "\"$sentryDsn\"")
        buildConfigField("String", "APTABASE_APP_KEY", "\"$aptabaseAppKey\"")
        buildConfigField("String", "APTABASE_HOST", "\"$aptabaseHost\"")
    }

    signingConfigs {
        create("release") {
            val storePath = keystoreProperties.getProperty("storeFile")
                ?: System.getenv("KEYSTORE_PATH")
            val storePass = keystoreProperties.getProperty("storePassword")
                ?: System.getenv("KEYSTORE_PASSWORD")
            val alias = keystoreProperties.getProperty("keyAlias")
                ?: System.getenv("KEY_ALIAS")
            val keyPass = keystoreProperties.getProperty("keyPassword")
                ?: System.getenv("KEY_PASSWORD")
            if (!storePath.isNullOrBlank() &&
                !storePass.isNullOrBlank() &&
                !alias.isNullOrBlank() &&
                !keyPass.isNullOrBlank()
            ) {
                storeFile = file(storePath)
                storePassword = storePass
                keyAlias = alias
                keyPassword = keyPass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation(platform("io.sentry:sentry-bom:8.33.0"))
    implementation("io.sentry:sentry-android")

    implementation("com.github.aptabase:aptabase-kotlin:0.0.8")
}

sentry {
    // Never require Sentry credentials for a local/fork build.
    // Token alone is not enough — sentry-cli also needs org + project.
    autoUploadProguardMapping.set(
        sentryEnabled &&
            !System.getenv("SENTRY_AUTH_TOKEN").isNullOrBlank() &&
            !System.getenv("SENTRY_ORG").isNullOrBlank() &&
            !System.getenv("SENTRY_PROJECT").isNullOrBlank(),
    )
    includeSourceContext.set(false)
    telemetry.set(false)
    tracingInstrumentation {
        enabled.set(sentryEnabled)
    }
}
