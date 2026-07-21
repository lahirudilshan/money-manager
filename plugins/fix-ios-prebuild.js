#!/usr/bin/env node
/**
 * Post-processes the ios/ project after every `expo prebuild`, fixing two
 * things Expo's config-plugin mod pipeline can't reliably fix in-place —
 * confirmed by tracing both `withEntitlementsPlist` and `withDangerousMod`
 * with debug logging: mods do not run in plugins-array order, so there is
 * no reliable in-pipeline hook for "run after this specific mod." Operating
 * on the finished files after `expo prebuild` completes is the one point
 * both of these are guaranteed to work.
 *
 * 1. Removes the `aps-environment` entitlement that `expo-notifications`
 *    adds to moneymanager.entitlements. This app only schedules local
 *    notifications (funding reminders) — it never calls
 *    getExpoPushTokenAsync or any remote-push API. But Apple's free/
 *    personal development teams cannot create a provisioning profile with
 *    the Push Notifications capability at all, so this entitlement blocks
 *    signing for anyone without a paid Apple Developer account.
 *
 * 2. Disables ENABLE_USER_SCRIPT_SANDBOXING on the moneymanager app target
 *    in project.pbxproj. CocoaPods already disables this on every Pods
 *    target (see ios/Pods/Pods.xcodeproj), but `expo prebuild` leaves it
 *    enabled on the main app target, where Expo's own Run Script build
 *    phases (e.g. writing the dev-launcher's ip.txt into the built .app)
 *    aren't sandbox-compliant and fail with:
 *      "Sandbox: bash deny file-write-create .../moneymanager.app/ip.txt"
 *
 * Run automatically via the `ios` and `prebuild:ios` npm scripts. Safe to
 * run repeatedly — a no-op once both fixes are already applied.
 */
const fs = require('fs');
const path = require('path');

const iosDir = path.join(__dirname, '..', 'ios');
const entitlementsPath = path.join(iosDir, 'moneymanager', 'moneymanager.entitlements');
const pbxprojPath = path.join(iosDir, 'moneymanager.xcodeproj', 'project.pbxproj');

if (!fs.existsSync(iosDir)) {
  console.log('[fix-ios-prebuild] No ios/ directory yet — nothing to do.');
  process.exit(0);
}

if (fs.existsSync(entitlementsPath)) {
  const contents = fs.readFileSync(entitlementsPath, 'utf8');
  const stripped = contents.replace(
    /\s*<key>aps-environment<\/key>\s*<string>[^<]*<\/string>/,
    '',
  );

  if (stripped === contents) {
    console.log('[fix-ios-prebuild] aps-environment already absent.');
  } else {
    fs.writeFileSync(entitlementsPath, stripped);
    console.log('[fix-ios-prebuild] Removed aps-environment entitlement.');
  }
}

if (fs.existsSync(pbxprojPath)) {
  const contents = fs.readFileSync(pbxprojPath, 'utf8');
  const patched = contents.replace(
    /ENABLE_USER_SCRIPT_SANDBOXING = YES;/g,
    'ENABLE_USER_SCRIPT_SANDBOXING = NO;',
  );

  if (patched === contents) {
    console.log('[fix-ios-prebuild] User script sandboxing already disabled.');
  } else {
    fs.writeFileSync(pbxprojPath, patched);
    console.log('[fix-ios-prebuild] Disabled user script sandboxing on the app target.');
  }
}
