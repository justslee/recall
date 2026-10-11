# Documentation screenshots

[Illustrated setup](../SETUP.md) · [Walkthroughs](../demos/README.md)

These images show the actual Recall interface with original demo content, synthetic learning entries and illustrative review history. They contain no personal library, knowledge-base notes, provider credentials, private pairing codes or real learner assessments.

## Mac screenshots

The `setup-*.png` and `demo-*.png` Mac screens were captured from the source app on October 11, 2026. The screenshot script uses a disposable profile and assistant home; it does not install into a real assistant account, pair a device, enable the companion, record audio, run card code or request AI feedback.

To refresh them from a prepared checkout:

```sh
npm run build
npm run docs:screenshots
npm run docs:check
```

This opens a temporary demo window, writes the images here and removes its temporary profile afterward. It needs desktop access on macOS. Review the generated images before publishing them. The sample page in the Mac Tutor Pad tray is explicitly labeled **Documentation example**; it is synthetic working, not a photographed or graded submission.

## iPad screenshots

`setup-ipad-home.png` and `setup-ipad-home-dark.png` show the earlier Study Index home design corresponding to TestFlight build 4, with a synthetic front-only demonstration sheet in a separate iPad simulator. They do not show the newer Live/Notebooks workspace selector. These simulator captures are not proof of real-device writing or transfer quality.

`setup-notebooks.png` and `setup-notebooks-dark.png` show the new private notebook source build, captured on October 11, 2026. The Linear Algebra notebook, Vectors and bases note and two empty pages are synthetic. These actual light/dark simulator screens do not establish physical Pencil writing, touch-swipe recognition or a live notebook-to-KB transfer; they are not part of TestFlight build 4.

Refresh these only in a disposable simulator with no pairing or personal sheets. Build the simulator app using the [native build guide](../IPAD_NATIVE.md), install and launch it in that simulator, then capture its light and dark appearance. The Mac screenshot command does not alter an iPad or simulator.

## Before sharing

- Inspect every changed image for private names, paths, notes and pairing codes.
- Keep full labels and relevant controls readable; avoid screenshots of API keys or live QR codes.
- Keep captions honest about demo data, unverified integrations and simulator captures.
- Run the documentation link check and release privacy audit. Text audits cannot establish pixel-level privacy.
