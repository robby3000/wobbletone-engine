// gl/uniforms.js — generic uniform upload.
// {name, type, value} -> the right uniform* call. Types:
// float|int|vec2|vec3|vec4|float[]|vec3[]|vec4[].
export function setUniform(gl, prog, { name, type, value }) {
  const loc = gl.getUniformLocation(prog, name);
  if (!loc) return;
  switch (type) {
    case "float": gl.uniform1f(loc, value); break;
    case "int": gl.uniform1i(loc, value); break;
    case "vec2": gl.uniform2f(loc, value[0], value[1]); break;
    case "vec3": gl.uniform3f(loc, value[0], value[1], value[2]); break;
    case "vec4": gl.uniform4f(loc, value[0], value[1], value[2], value[3]); break;
    case "float[]": gl.uniform1fv(loc, value); break;
    case "vec3[]": gl.uniform3fv(loc, value); break;
    case "vec4[]": gl.uniform4fv(loc, value); break;
  }
}
