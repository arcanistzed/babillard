# JNA finds these classes and their fields by reflection, so minifying must leave them alone.
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-dontwarn java.awt.**
-keep class uniffi.babillard_mls.** { *; }
