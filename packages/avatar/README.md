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
does. `listCharacters()` returns that set:

```js
import { listCharacters } from "@voqalize/avatar";

for (const c of await listCharacters()) {
  // c.name, c.still (an image URL), c.gender, c.age.min, c.age.max,
  // c.ethnicity[], c.tags[], c.suggestedVoices[]
}
```

Use it to build a picker or a filter rather than writing the names down. The
words in `gender`, `ethnicity` and `tags` come from closed lists, so a filter
you build from one call matches the next. `suggestedVoices` lists the voices
that suit the face, best first, as Voqalize voice ids such as
`omnivoice/gauri`. It is advice: the avatar never speaks.

The gains are optional, from `0` to `2`, and `1` is as authored:

- `mouthGain` sets how far the mouth moves.
- `gestureGain` sets the size of nods and other gestures.
- `motionGain` sets the amount of idle motion.

The client must be connected to a Voqalize session that has the avatar turned on.

## Preload before the call

Building a face takes the browser a moment: the runtime, the character, a GPU
context and its shaders. On a slow phone that is over a second after the call
connects before the face appears. `preloadAvatar` does that work before the call, off screen, so the
mount that follows only moves the finished face onto the page:

```js
import { preloadAvatar, unloadAvatar } from "@voqalize/avatar";

// when the visitor is about to talk: the page with the call button, or hover on it
const face = preloadAvatar("<name>");

// later, the ordinary mount takes the preloaded face
createAvatar({ mount, client, character: "<name>" });

// or, if the visitor leaves without calling
unloadAvatar(face);
```

- One face is held at a time. Preloading the same character again returns the
  same handle; preloading another frees the one held.
- A mount of that character, through `createAvatar` or `<Avatar>`, takes the
  face. After that the handle holds nothing and `unloadAvatar` does nothing,
  and `destroy()` frees the face as usual.
- `face.ready` settles when the face is built, or when it cannot be (no
  WebGL 2, for example) and the mount will build it the ordinary way. You
  never need to wait for it before mounting. It rejects only for a name that is
  no character.
- `unloadAvatar` frees the GPU context and the character's memory at once,
  and is safe to call at any time.

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
