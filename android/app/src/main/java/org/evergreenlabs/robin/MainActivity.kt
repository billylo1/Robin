package org.evergreenlabs.robin

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.evergreenlabs.robin.ui.RootScreen
import org.evergreenlabs.robin.ui.theme.RobinTheme
import java.util.Locale

class MainActivity : ComponentActivity() {

    private val benchmarkReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == "org.evergreenlabs.robin.RUN_BENCHMARK") {
                Log.i("RobinBenchmark", "Broadcast received: running in-app benchmark...")
                AppGraph.benchmark.runBenchmark { result ->
                    if (result != null) {
                        val delta = result.deltaVs(AppGraph.benchmark.baselineResult.value)
                        Log.i(
                            "RobinBenchmark",
                            "BENCHMARK_RESULT: initialLoad=${result.initialLoadMs}ms (delta: ${String.format(Locale.US, "%+.1f", delta.initialLoadPct)}%), " +
                            "scrollRenderCompletion=${result.scrollRenderCompletionMs}ms (delta: ${String.format(Locale.US, "%+.1f", delta.scrollRenderPct)}%), " +
                            "bootReady=${result.bootReady}, isRegressed=${delta.isRegressed}"
                        )
                    } else {
                        Log.e("RobinBenchmark", "BENCHMARK_RESULT: failed (null result)")
                    }
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        val filter = IntentFilter("org.evergreenlabs.robin.RUN_BENCHMARK")
        ContextCompat.registerReceiver(
            this,
            benchmarkReceiver,
            filter,
            ContextCompat.RECEIVER_EXPORTED,
        )

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

    override fun onDestroy() {
        super.onDestroy()
        try {
            unregisterReceiver(benchmarkReceiver)
        } catch (_: Exception) {}
    }
}
