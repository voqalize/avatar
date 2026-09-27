# @voqalize/avatar

A talking head for AI voice calls. Give it your live `PipecatClient` and an
element, and a character in that element speaks the bot's audio, lip-synced,
and shows the state of the call: listening, thinking, being interrupted.

This package is the loader. The avatar itself (the characters, the renderer and
everything that follows the call) is the Voqalize avatar runtime, which this
package imports from `https://avatar.voqalize.com` when the first avatar mounts.
Each release of this package is pinned to the runtime it was released with, so
upgrading the package is how you upgrade the avatar.

## Install

```sh
npm install @voqalize/avatar
```

The package is ESM, has no runtime dependencies and ships its own types.
`@pipecat-ai/client-js` (`>=1.4 <2`) and React (`>=18`) are optional peers. The
pipecat import is used only for types, and React is used only by
`@voqalize/avatar/react`.

## Mount a character

Mount it wherever your app renders the bot's tile:

```js
import { createAvatar } from "@voqalize/avatar";

const avatar = createAvatar({
  mount: document.querySelector("#bot-tile"),
  client: pipecatClient,
  character: "<name>",
});

// when the call ends, or the tile goes away
avatar.destroy();
```

`createAvatar` returns at once, and the face appears when the runtime and the
character have loaded. The avatar owns the contents of `mount` and sizes itself
to it. `destroy()` is safe to call at any time, including before the face has
appeared.

`character` names one of the characters you can meet at
https://voqalize.com/demos/avatar. Each release of this package can mount a
fixed set of them, and a name it does not have throws, listing the ones it
does.

The gains are optional, from `0` to `2`, and `1` is as authored:

- `mouthGain` sets how far the mouth moves.
- `gestureGain` sets the size of nods and other gestures.
- `motionGain` sets the amount of idle motion.

The client must be connected to a Voqalize session that has the avatar turned on.

### React

```jsx
import { Avatar } from "@voqalize/avatar/react";

<Avatar client={client} character="<name>" className="bot-tile" />
```

Nothing mounts while `client` is `null`. A new `client` or `character` rebuilds
the avatar. The gains are read when the avatar mounts. Every other prop goes to
the `<div>` the avatar renders into.

## Content Security Policy

If your page sets a Content-Security-Policy, add these sources:

- `script-src https://avatar.voqalize.com`, because the runtime is a module
  imported from there.
- `connect-src https://avatar.voqalize.com blob:`, because the runtime fetches
  the character from there and decodes the character's textures from `blob:`
  URLs.
- `img-src https://avatar.voqalize.com blob:`. The asset host serves the
  still photograph shown where a browser has no WebGL 2, as a call whose other
  side has turned their camera off; without it that tile shows an empty circle.
  `blob:` is for Safari before 17 and Firefox before 98, which decode the
  character's textures through an image element.

The runtime needs nothing else: no workers, no inline styles and no `eval`.

## Bundlers

The runtime is imported with a literal `import()` of its URL, marked so that
Vite and webpack leave it alone. Your bundle carries only this package, a few
kilobytes, and the browser fetches the runtime once per page however many
avatars mount.

## Licence

This package is MIT; see [LICENSE](./LICENSE). The runtime it loads is not open
source. Its terms are at https://avatar.voqalize.com/LICENSE.
