package org.evergreenlabs.robin.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import org.evergreenlabs.robin.AppGraph

@Composable
fun RootScreen(
    modifier: Modifier = Modifier,
) {
    val chrome = AppGraph.chrome
    val snackbarHostState = remember { SnackbarHostState() }
    val layoutDirection = LocalLayoutDirection.current

    val toastMessage by chrome.toastMessage.collectAsStateWithLifecycle()

    LaunchedEffect(toastMessage) {
        val message = toastMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        delay(2500)
        chrome.clearToast()
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        // Let XWebFeedScreen's TopAppBar own status-bar insets (avoid double top padding).
        contentWindowInsets = WindowInsets(0.dp),
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    start = padding.calculateStartPadding(layoutDirection),
                    end = padding.calculateEndPadding(layoutDirection),
                    bottom = padding.calculateBottomPadding(),
                ),
        ) {
            XWebFeedScreen(modifier = Modifier.fillMaxSize())
        }
    }
}
