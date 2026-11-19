/** Just enough of the class file format to find a class's main methods. No imports, so Node scripts can use it. */

/** The `main` methods a class file declares (private ones can't be launched). */
export function mainMethods(bytes: Uint8Array | Int8Array): { isStatic: boolean; takesArgs: boolean }[] {
  const cls = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const v = new DataView(cls.buffer, cls.byteOffset, cls.byteLength);
  let o = 8;
  const u2 = () => ((o += 2), v.getUint16(o - 2));
  const u4 = () => ((o += 4), v.getUint32(o - 4));
  const count = u2();
  const utf8: (string | null)[] = [null];
  const dec = new TextDecoder();
  for (let i = 1; i < count; i++) {
    const tag = cls[o++];
    if (tag === 1) {
      const len = u2();
      utf8[i] = dec.decode(cls.subarray(o, o + len));
      o += len;
    } else {
      utf8[i] = null;
      if (tag === 5 || tag === 6) (o += 8), (utf8[++i] = null);
      else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) o += 2;
      else if (tag === 15) o += 3;
      else o += 4; // 3, 4, 9, 10, 11, 12, 17, 18
    }
  }
  o += 6; // access, this, super
  const interfaces = u2();
  o += 2 * interfaces;
  const members = (visit?: (flags: number, name: string | null, desc: string | null) => void) => {
    for (let n = u2(); n > 0; n--) {
      const flags = u2();
      const name = utf8[u2()];
      const desc = utf8[u2()];
      for (let a = u2(); a > 0; a--) {
        o += 2; // name
        const len = u4();
        o += len;
      }
      visit?.(flags, name, desc);
    }
  };
  members(); // fields
  const found: { isStatic: boolean; takesArgs: boolean }[] = [];
  members((flags, name, desc) => {
    if (name !== "main" || flags & 0x0002 /* private */) return;
    if (desc === "([Ljava/lang/String;)V" || desc === "()V") found.push({ isStatic: (flags & 0x0008) !== 0, takesArgs: desc !== "()V" });
  });
  return found;
}
