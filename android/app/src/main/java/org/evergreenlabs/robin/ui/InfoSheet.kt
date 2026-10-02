package org.evergreenlabs.robin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.evergreenlabs.robin.AppConfig
import org.evergreenlabs.robin.AppGraph
import org.evergreenlabs.robin.R
import org.evergreenlabs.robin.services.FeedRefreshIntervalStore
import org.evergreenlabs.robin.services.FontScaleStore
import org.evergreenlabs.robin.xfilter.FilterSettings
import org.evergreenlabs.robin.xfilter.HomeFeedMode

/**
 * Settings for the WebView filter path.
 * Text size scales the X WebView (and native chrome via LocalDensity).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InfoSheet(
    onDismiss: () -> Unit,
    onSignOut: () -> Unit = {},
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val uriHandler = LocalUriHandler.current
    val minimalTwitterUrl = stringResource(R.string.about_minimal_twitter_link)
    val robinRepoUrl = stringResource(R.string.about_robin_repo_link)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 4.dp),
        ) {
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.align(Alignment.CenterStart),
            ) {
                Text(stringResource(R.string.done))
            }
            Text(
                text = stringResource(R.string.settings),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.align(Alignment.Center),
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp),
        ) {
            Text(
                text = stringResource(R.string.user_interface),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(8.dp))
            GeneralSettingsGroup()
            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(12.dp))
            HomeFeedSection()
            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(12.dp))
            ShowTogglesSection()
            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.credits),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.about_minimal_twitter),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(4.dp))
            TextButton(
                onClick = { uriHandler.openUri(minimalTwitterUrl) },
                modifier = Modifier.padding(horizontal = 0.dp),
            ) {
                Text(stringResource(R.string.about_minimal_twitter_button))
            }
            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.about),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = stringResource(
                    R.string.version_label,
                    AppConfig.versionName,
                    AppConfig.versionCode,
                ),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(4.dp))
            TextButton(
                onClick = { uriHandler.openUri(robinRepoUrl) },
                modifier = Modifier.padding(horizontal = 0.dp),
            ) {
                Text(stringResource(R.string.about_robin_repo_button))
            }
            Spacer(modifier = Modifier.height(16.dp))
            Button(
                onClick = {
                    onSignOut()
                    onDismiss()
                },
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError,
                ),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.sign_out))
            }
        }
    }
}

@Composable
private fun GeneralSettingsGroup() {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            FontSizeRow()
            Spacer(modifier = Modifier.height(12.dp))
            AutoRefreshRow()
        }
    }
}

@Composable
private fun FontSizeRow() {
    val fontScale = AppGraph.fontScale
    val scale by fontScale.scale.collectAsStateWithLifecycle()
    val percent = remember(scale) { "${(scale * 100f).toInt()}%" }
    val decreaseDesc = stringResource(R.string.decrease_text_size)
    val increaseDesc = stringResource(R.string.increase_text_size)
    val sizeDesc = stringResource(R.string.text_size_percent, percent)

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = stringResource(R.string.text_size),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AdjustButton(
                label = "A−",
                enabled = scale > FontScaleStore.MIN + 1e-4f,
                contentDescription = decreaseDesc,
                onClick = { fontScale.bump(-FontScaleStore.STEP) },
            )
            Text(
                text = percent,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .width(AdjustValueWidth)
                    .semantics { contentDescription = sizeDesc },
            )
            AdjustButton(
                label = "A+",
                enabled = scale < FontScaleStore.MAX - 1e-4f,
                contentDescription = increaseDesc,
                onClick = { fontScale.bump(FontScaleStore.STEP) },
            )
        }
    }
}

@Composable
private fun AutoRefreshRow() {
    val store = AppGraph.feedRefreshInterval
    val seconds by store.seconds.collectAsStateWithLifecycle()
    val label = remember(seconds) { FeedRefreshIntervalStore.labelFor(seconds) }
    val decreaseDesc = stringResource(R.string.decrease_auto_refresh)
    val increaseDesc = stringResource(R.string.increase_auto_refresh)
    val intervalDesc = stringResource(R.string.auto_refresh_interval, label)

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = stringResource(R.string.auto_refresh),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AdjustButton(
                label = "−",
                enabled = store.canDecrease,
                contentDescription = decreaseDesc,
                onClick = { store.bump(-1) },
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .width(AdjustValueWidth)
                    .semantics { contentDescription = intervalDesc },
            )
            AdjustButton(
                label = "+",
                enabled = store.canIncrease,
                contentDescription = increaseDesc,
                onClick = { store.bump(1) },
            )
        }
    }
}

private val AdjustButtonWidth = 64.dp
private val AdjustValueWidth = 56.dp

@Composable
private fun AdjustButton(
    label: String,
    enabled: Boolean,
    contentDescription: String,
    onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .width(AdjustButtonWidth)
            .semantics { this.contentDescription = contentDescription },
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp),
    ) {
        Text(label, maxLines = 1)
    }
}

@Composable
private fun HomeFeedSection() {
    val store = AppGraph.filterSettings
    val settings by store.settings.collectAsStateWithLifecycle(initialValue = FilterSettings.Default)
    val scope = rememberCoroutineScope()

    Text(
        text = stringResource(R.string.filter_home_timeline),
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurface,
    )
    Spacer(modifier = Modifier.height(8.dp))
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = 16.dp, vertical = 6.dp)
                .selectableGroup()
        ) {
            HomeFeedMode.entries.forEach { mode ->
                val selected = settings.homeFeedMode == mode
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .selectable(
                            selected = selected,
                            onClick = {
                                scope.launch { store.update { it.withHomeFeedMode(mode) } }
                            },
                            role = Role.RadioButton,
                        )
                        .padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(
                        selected = selected,
                        onClick = null,
                    )
                    Text(
                        text = stringResource(mode.labelRes),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ShowTogglesSection() {
    val store = AppGraph.filterSettings
    val settings by store.settings.collectAsStateWithLifecycle(initialValue = FilterSettings.Default)
    val scope = rememberCoroutineScope()

    Text(
        text = stringResource(R.string.filter_display),
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurface,
    )
    Spacer(modifier = Modifier.height(8.dp))
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            FilterSwitchRow(
                label = stringResource(R.string.filter_show_compose),
                checked = !settings.hideComposeButton,
                onCheckedChange = { v ->
                    scope.launch { store.update { it.copy(hideComposeButton = !v) } }
                },
            )
            FilterSwitchRow(
                label = stringResource(R.string.filter_show_live_content),
                checked = !settings.hideLiveContent,
                onCheckedChange = { v ->
                    scope.launch { store.update { it.copy(hideLiveContent = !v) } }
                },
            )
        }
    }
}

@Composable
private fun FilterSwitchRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = if (enabled) {
                MaterialTheme.colorScheme.onSurface
            } else {
                MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
            },
            modifier = Modifier
                .weight(1f)
                .padding(end = 12.dp),
        )
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            enabled = enabled,
        )
    }
}
