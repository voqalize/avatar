/**
 * The only thing on this page that needs a bundler, and it is somebody else's code.
 *
 * `@pipecat-ai/client-js` and `@pipecat-ai/small-webrtc-transport` ship ESM, but
 * their ESM still contains bare specifiers (`events`, `uuid`, `bowser`,
 * `lodash/cloneDeep`, and client-js itself) that a browser cannot resolve. So the
 * two are pre-bundled — together, in one file, because the transport imports
 * client-js and two separate bundles would put two copies of it on the page.
 *
 *     npm run demo:vendor
 *
 * Nothing of ours goes through this. `src/` and `client/dist/` are served
 * straight from the working tree and stay live-editable, which is the property
 * the repo actually cares about.
 */
export { PipecatClient } from "@pipecat-ai/client-js";
export { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
