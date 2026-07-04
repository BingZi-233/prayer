interface Segment { type: string; data: Record<string, string> }

// 从任意段数组抽文本与图片 url(get_msg / get_forward_msg 节点复用)。
// 不递归 reply/forward,防死循环与 token 爆炸。
export function extractSegments(segs: unknown): { text: string; imageUrls: string[] } {
  const imageUrls: string[] = [];
  let text = "";
  if (Array.isArray(segs)) {
    for (const seg of segs as Segment[]) {
      if (seg?.type === "text") text += seg.data?.text ?? "";
      else if (seg?.type === "image") {
        const u = seg.data?.url ?? seg.data?.file;
        if (u) imageUrls.push(u);
      }
    }
  } else if (typeof segs === "string") {
    const cq = /\[CQ:image,([^\]]*)\]/g;
    let m: RegExpExecArray | null;
    while ((m = cq.exec(segs)) !== null) {
      const args = Object.fromEntries(
        m[1].split(",").filter(Boolean).map((kv) => {
          const i = kv.indexOf("=");
          return [kv.slice(0, i), kv.slice(i + 1)];
        })
      );
      const u = args.url ?? args.file;
      if (u) imageUrls.push(u);
    }
    text = segs.replace(/\[CQ:[^\]]*\]/g, "");
  }
  return { text: text.trim(), imageUrls };
}

export interface ImageData {
  data: string; // base64
  mediaType: string;
}

// 下载图片 url → base64 + media_type。失败抛错,由调用方(enrich)兜底跳过。
export async function fetchImageBase64(url: string): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`图片下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type")?.split(";")[0]?.trim();
  const mediaType = ct && ct.startsWith("image/") ? ct : "image/jpeg";
  return { data: buf.toString("base64"), mediaType };
}
