package org.evergreenlabs.robin.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val BrandBlue = Color(0xFF1D9BF0)
val ErrorRed = Color(0xFFEF5350)
val OptimalGreen = Color(0xFF00BA7C)
/** Header / brand cream (matches launcher mark). */
val RobinCream = Color(0xFFF5F0E8)
/** Dark-mode header chrome (matches DarkColors.surface). */
val RobinHeaderDark = Color(0xFF15202B)
/** Robin breast orange-red — used instead of Twitter blue in chrome. */
val RobinRed = Color(0xFFD9481C)
/** Lighter breast red for dark chrome (readable on RobinHeaderDark). */
val RobinRedLight = Color(0xFFFF6B45)

private val LightColors = lightColorScheme(
    primary = BrandBlue,
    onPrimary = Color.White,
    secondary = BrandBlue,
    background = Color(0xFFF7F9FA),
    surface = Color.White,
    surfaceVariant = Color(0xFFEFF3F4),
    onBackground = Color(0xFF0F1419),
    onSurface = Color(0xFF0F1419),
    onSurfaceVariant = Color(0xFF536471),
    outline = Color(0xFFCFD9DE),
    error = ErrorRed,
)

private val DarkColors = darkColorScheme(
    primary = BrandBlue,
    onPrimary = Color.White,
    secondary = BrandBlue,
    background = Color(0xFF0F1419),
    surface = Color(0xFF15202B),
    surfaceVariant = Color(0xFF1E2732),
    onBackground = Color(0xFFE7E9EA),
    onSurface = Color(0xFFE7E9EA),
    onSurfaceVariant = Color(0xFF8B98A5),
    outline = Color(0xFF38444D),
    error = ErrorRed,
)

@Composable
fun RobinTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
