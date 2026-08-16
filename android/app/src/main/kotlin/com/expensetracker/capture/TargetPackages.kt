package com.expensetracker.capture

/**
 * Packages the NotificationListenerService captures from. Confirmed
 * on-device (adb shell pm list packages / a package-viewer app) per
 * agents.md §14 phase 1 — regional bank apps can share a display name
 * but not a package id, so this list is only trustworthy because it
 * came from the actual device, not assumed from the app's public name.
 *
 * Shopee and Pinduoduo are deliberately excluded — high notification
 * volume relative to actual transactions; recorded manually instead so
 * phase 1's capture stream doesn't get noisy.
 */
object TargetPackages {
    val ALL: Set<String> = setOf(
        "my.com.tngdigital.ewallet", // TnG eWallet
        "com.cimb.cimbocto", // CIMB Octo MY
        "com.transferwise.android", // Wise
        "com.eg.android.AlipayGphone", // Alipay
        "com.google.android.apps.walletnfcrel", // Google Wallet
        "com.samsung.android.spay", // Samsung Wallet / Pay
    )
}
