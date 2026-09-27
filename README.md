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
  character: "<name>",
});
```

The package is a small MIT loader. The avatar itself (the characters, the
renderer and everything that follows the call) is the Voqalize avatar runtime.
The package imports it from `https://avatar.voqalize.com` when the first avatar
mounts, and each release of the package is pinned to the runtime it was
released with. The client must be connected to a Voqalize session that has the
avatar turned on.

Choosing a character, the React component, the gains and the
Content-Security-Policy a page needs are in
[packages/avatar/README.md](packages/avatar/README.md).

## What is in this repository

The npm package, in `packages/avatar/`. It is developed in a private working
tree and arrives here as one commit per release ([RELEASING.md](RELEASING.md)).
Bug reports are welcome; [CONTRIBUTING.md](CONTRIBUTING.md) says why pull
requests usually are not the way to send one.

`voqalize-avatar`, the Python package that once lived here, is deprecated. Its
releases stay on PyPI, and the source is in this repository's history.

## Licence

Everything in this repository is [MIT](LICENSE). The avatar runtime that
`@voqalize/avatar` loads is not in this repository and is not open source; its
terms are at https://avatar.voqalize.com/LICENSE.
