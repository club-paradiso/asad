# Zero-configuration live speech input

`tong-yuck` treats browser-native Web Speech as the default live recogniser when no usable cloud STT provider is configured and the current browser supports it.

This keeps production usable even if `STT_PROVIDER` is left at `demo` in a deployment environment. The scripted demo remains available as an explicit fallback and for unsupported browsers.

Priority is:

1. Configured, usable cloud STT provider
2. Browser-native Web Speech
3. Scripted demo

The browser recogniser is still started from the user's direct Start button interaction so permission-sensitive browsers retain user activation.
