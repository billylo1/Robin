package org.evergreenlabs.robin

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.evergreenlabs.robin.ui.RootScreen
import org.evergreenlabs.robin.ui.theme.RobinTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            val userFontScale by AppGraph.fontScale.scale.collectAsStateWithLifecycle()
            val density = LocalDensity.current
            CompositionLocalProvider(
                LocalDensity provides Density(
                    density = density.density,
                    fontScale = density.fontScale * userFontScale,
                ),
            ) {
                RobinTheme {
                    Surface {
                        RootScreen()
                    }
                }
            }
        }
    }
}
