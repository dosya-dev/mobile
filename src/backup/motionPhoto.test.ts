import { parseMotionPhotoOffset, base64ToBytes } from "./motionPhoto";

const enc = (s: string) => new TextEncoder().encode(s);
const SOI = new Uint8Array([0xff, 0xd8]);
/** Wrap an XMP packet in a JPEG APP1 segment after SOI. */
function jpegWithXmp(xmp: string): Uint8Array {
  const ns = enc("http://ns.adobe.com/xap/1.0/\0");
  const body = enc(xmp);
  const len = 2 + ns.length + body.length;
  return new Uint8Array([...SOI, 0xff, 0xe1, len >> 8, len & 0xff, ...ns, ...body, 0xff, 0xda]);
}

const PIXEL_LEGACY = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" GCamera:MicroVideo="1" GCamera:MicroVideoVersion="1" GCamera:MicroVideoOffset="4185066" GCamera:MicroVideoPresentationTimestampUs="1234"/></rdf:RDF></x:xmpmeta>`;
const PIXEL_CONTAINER = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" GCamera:MotionPhoto="1"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="3128172" Item:Padding="0"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>`;
const SAMSUNG = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="MotionPhoto" Item:Mime="video/mp4" Item:Length="2599183" Item:Padding="8"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>`;

describe("parseMotionPhotoOffset", () => {
  it("reads the legacy MicroVideoOffset", () => {
    expect(parseMotionPhotoOffset(jpegWithXmp(PIXEL_LEGACY))).toBe(4185066);
  });
  it("reads a Container directory's MotionPhoto item length", () => {
    expect(parseMotionPhotoOffset(jpegWithXmp(PIXEL_CONTAINER))).toBe(3128172);
  });
  it("adds Item:Padding, so Samsung's trailer is included", () => {
    expect(parseMotionPhotoOffset(jpegWithXmp(SAMSUNG))).toBe(2599183 + 8);
  });
  it("returns null for a JPEG with no XMP, a non-JPEG, and garbage XMP", () => {
    expect(parseMotionPhotoOffset(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 0]))).toBeNull();
    expect(parseMotionPhotoOffset(enc("GIF89a"))).toBeNull();
    expect(parseMotionPhotoOffset(jpegWithXmp("<x:xmpmeta><<<garbage MicroVideoOffset=\"abc\""))).toBeNull();
    expect(parseMotionPhotoOffset(jpegWithXmp(PIXEL_LEGACY.replace("4185066", "0")))).toBeNull();
  });
  it("survives a header truncated inside the APP1 segment", () => {
    expect(parseMotionPhotoOffset(jpegWithXmp(PIXEL_LEGACY).slice(0, 40))).toBeNull();
  });
  it("base64ToBytes decodes without atob", () => {
    expect(Array.from(base64ToBytes("/9j/2g=="))).toEqual([0xff, 0xd8, 0xff, 0xda]);
    expect(Array.from(base64ToBytes("/9j/"))).toEqual([0xff, 0xd8, 0xff]);
    expect(Array.from(base64ToBytes("AAAA////"))).toEqual([0, 0, 0, 255, 255, 255]);
  });
});
