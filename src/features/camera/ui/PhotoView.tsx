import { useEffect, useState } from "react";
import type { Photo } from "../../../shared/types";
import { renderPhoto } from "../lib/render";

/** 把曝光记录渲染为照片；冲印中的照片显示显影动画。 */
export function PhotoView({
  photo,
  w = 480,
  h = 288,
  className,
}: {
  photo: Photo;
  w?: number;
  h?: number;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!photo.ready) {
      setUrl("");
      return;
    }
    const canvas = renderPhoto(photo.record, w, h);
    setUrl(canvas.toDataURL("image/jpeg", 0.85));
  }, [photo, w, h]);
  if (!photo.ready)
    return (
      <div className={"photo-view developing " + (className ?? "")} role="status">
        <span />
        冲印中…
      </div>
    );
  return url ? (
    <img
      className={"photo-view " + (className ?? "")}
      src={url}
      alt={`水下照片：${photo.findings.map((f) => f.sp).join("、") || "空镜"}`}
    />
  ) : (
    <div className={"photo-view developing " + (className ?? "")} />
  );
}
