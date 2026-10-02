package org.evergreenlabs.robin.services

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** In-app chrome: settings sheet + snackbar toast. */
class AppChrome {
    private val _infoPresented = MutableStateFlow(false)
    val infoPresented: StateFlow<Boolean> = _infoPresented.asStateFlow()

    private val _toastMessage = MutableStateFlow<String?>(null)
    val toastMessage: StateFlow<String?> = _toastMessage.asStateFlow()

    fun setInfoPresented(value: Boolean) {
        _infoPresented.value = value
    }

    fun showToast(message: String) {
        _toastMessage.value = message
    }

    fun clearToast() {
        _toastMessage.value = null
    }
}
