# Avatar — a talking head for Voqalize voice calls

A character that speaks the bot's audio in a Voqalize call, lip-synced, and
shows the state of the call: listening, thinking, being interrupted. It renders
in the browser, next to the call you already have. It adds no video track and
no second media path.

### → [Talk to one](https://voqalize.com/demos/avatar)

## `@voqalize/avatar`

```sh
npm install @voqalize/avatar
```

```js
import { createAvatar } from "@voqalize/avatar";

const avatar = createAvatar({
  mount: document.querySelector("#bot-tile"),
  client: pipecatClient,
  character: "tara",
});
```

The package is a small MIT loader. The avatar itself (the characters, the
renderer and everything that follows the call) is the Voqalize avatar runtime.
The package imports it from `https://avatar.voqalize.com` when the first avatar
mounts, and each release of the package is pinned to the runtime it was
released with. The client must be connected to a Voqalize session that has the
avatar turned on.

The characters, the React component, the gains and the Content-Security-Policy
a page needs are in [packages/avatar/README.md](packages/avatar/README.md).

## `voqalize-avatar` is deprecated

The Python package drove the avatar from a pipecat pipeline of your own. The
Voqalize platform now decides what the avatar does on the server, so 0.4.1 is
the package's last release and nothing replaces it. The releases already
published stay on PyPI, and they keep working with the `@voqalize/avatar` 0.4.x
versions they were released alongside. [`apps/server/`](apps/server/README.md),
the demo call that ran it, goes with it.

## What is in this repository

- `packages/avatar/` — the npm package. It is developed in a private working
  tree and arrives here as one commit per release ([RELEASING.md](RELEASING.md)).
- `packages/avatar-py/` — `voqalize-avatar`, deprecated.
- `apps/server/` — the demo call for `voqalize-avatar`, deprecated with it.

Bug reports are welcome; [CONTRIBUTING.md](CONTRIBUTING.md) says which changes
this repository can take.

## Licence

Everything in this repository is [MIT](LICENSE). The avatar runtime that
`@voqalize/avatar` loads is not in this repository and is not open source; its
terms are at https://avatar.voqalize.com/LICENSE.

What follows is the attribution that travels with material we did not write.

The `avatarsync` aligner in `packages/avatar-py/native/avatarsync/` is a fork of
[Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) (MIT). Its
prebuilt binaries statically link pocketsphinx, sphinxbase, flite, WebRTC,
cppformat, GSL, Boost and the CMU acoustic model; upstream's own notice file for
all of them is committed beside them as
`packages/avatar-py/native/avatarsync/UPSTREAM-LICENSE.md`, unchanged, and
travels with that directory.

| third-party material | where | terms |
|---|---|---|
| Rhubarb Lip Sync 1.14.0 | `packages/avatar-py/native/avatarsync/` (fetched at build time, not vendored) | MIT; see `UPSTREAM-LICENSE.md` |
| [piper](https://github.com/OHF-Voice/piper1-gpl) voices `en_US-ljspeech-high`, `en_US-libritts_r-medium` | spoke every clip in `packages/avatar-py/tests/fixtures/` (pcm) | LJSpeech public domain; LibriTTS-R CC BY 4.0 |

All demo audio is synthesised from text written for this repository;
`apps/server/audio/` is Voqalize's own `omnivoice` voices.
