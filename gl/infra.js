// gl/infra.js — shared GPU plumbing state.
//
// One live context + its program cache + texture pool. On
// webglcontextrestored the session generation bumps and this rebuilds
// lazily on next use — GPU state is recompiled from source, never
// assumed to survive a loss.

import { acquireGLContext } from "./context.js";
import { ProgramCache } from "./programs.js";
import { TexturePool } from "./textures.js";

let infra = null; // { generation, session, programs, pool }

export function ensureInfra() {
  const session = acquireGLContext();
  if (!session || session.lost) return null;
  if (!infra || infra.generation !== session.generation) {
    infra?.programs?.dispose();
    infra?.pool?.dispose();
    infra = {
      generation: session.generation,
      session,
      programs: new ProgramCache(session.gl),
      pool: new TexturePool(session.gl),
    };
  }
  return infra;
}
