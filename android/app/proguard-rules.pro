# No service_role key ever lands here. The anon key + user JWT are the
# only credentials the app holds; RLS is the security boundary.
# Keep R8 rules for OkHttp / kotlinx.serialization if enabled later.
-dontwarn okhttp3.**
-dontwarn okio.**
-keepattributes *Annotation*
