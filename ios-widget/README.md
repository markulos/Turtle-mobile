# The lock-screen Live Activity layout

`LiveActivityView.swift` here is Turtle's copy of expo-live-activity's widget
view, with the pomodoro COUNTDOWN moved to the top right and set at 44 pt bold
rounded (it was the small caption label under the progress bar, bottom-left —
the least prominent spot on the card for the one number the card exists to
show). The bar stays, without labels, so the time is not printed twice.

Everything else in the file is the library's, untouched, so a version bump is a
re-diff rather than a rewrite.

## Why it lives here

The library's config plugin copies its own `ios-files/` into
`ios/LiveActivity/` on every prebuild and takes no option for a different
source. So an edit in `node_modules` dies at the next install, and one in
`ios/` dies at the next prebuild. `plugins/withTurtleLiveActivity.js` runs
after the library's plugin and writes this file over the copied one.

## IT IS NOT ENABLED YET — and that is deliberate

`./plugins/withTurtleLiveActivity` is NOT in `app.json`'s plugin list.

Adding a config plugin changes the native config, which changes the runtime
fingerprint that `expo-updates runtimeversion:resolve` computes and that every
OTA publish targets. Registering it moved the fingerprint from

    057c3e34830ffbe48f29d13228b1201a6bf32f0d   (what the installed build runs)
    aa93a8756b2eb02c8ada80f8e7a2ae75d644bac8   (with the plugin registered)

— and a publish against the second one is invisible to a phone running the
first. The installed app would simply stop seeing updates, with no error.

The layout is native, so it cannot reach a phone over the air ANYWAY. Leaving
it unregistered costs nothing today and keeps the OTA channel working; turning
it on buys nothing until there is a build.

## To ship it

1. Add `"./plugins/withTurtleLiveActivity"` to `expo.plugins` in `app.json`,
   immediately AFTER `"expo-live-activity"` — it has to overwrite what that
   plugin copies, so order is the mechanism.
2. Build and install: `npm run build:ios:dev` (or the production profile).
   The fingerprint will be `aa93a875…`; that is expected and is what the new
   build will run.
3. Publish OTA updates as usual afterwards — they will resolve to the new
   runtime because the checkout and the build now agree again.

Until step 2 is installed on the phone, keep the plugin OUT of `app.json`.
