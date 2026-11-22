import { useEffect, useRef } from "react";
import {
  Aperture,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  ImagePlus,
  Images,
  Scan,
  Timer,
  Trash2,
} from "lucide-react";
import type { CameraState, GameDocument, Photo } from "../../../shared/types";
import type { Command } from "../../../shared/commands";
import { species } from "../../../shared/catalog";
import { water } from "../../waters";
import {
  estimateRecord,
  framesOf,
  sustainablePrecision,
  RECORD_BUDGET,
  PRECISION_STEPS,
} from "../model/exposure";
import { CLARITY_LABEL } from "../model/identify";
import { ALBUM_MAX } from "../model/photos";
import { drawLive, renderPostcard } from "../lib/render";
import { PhotoView } from "./PhotoView";

const W = 920;
const H = 600;

function Chips({ photo }: { photo: Photo }) {
  if (!photo.findings.length)
    return <small className="no-find">空镜 · 没有可辨识的鱼影</small>;
  return (
    <div className="find-chips">
      {photo.findings.map((f, i) => (
        <span key={i} className={"find-chip " + f.clarity}>
          {species(f.sp).name} · {CLARITY_LABEL[f.clarity]}
        </span>
      ))}
    </div>
  );
}

export function CameraPanel({
  doc,
  camera,
  send,
}: {
  doc: GameDocument;
  camera: CameraState;
  send: (c: Command) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const accRef = useRef<HTMLCanvasElement | null>(null);
  const accFrameRef = useRef(-1);
  const s = camera.settings;
  const sh = camera.shooting;
  const est = estimateRecord(s);
  const over = est > RECORD_BUDGET;
  const sustain = over ? sustainablePrecision(s) : null;
  const frames = framesOf(s);
  const frameDur = s.exposure;
  const totalTime = frames * s.exposure;
  const precisionIdx = PRECISION_STEPS.reduce(
    (best, p, i) => (Math.abs(p - s.precision) < Math.abs(PRECISION_STEPS[best] - s.precision) ? i : best),
    0,
  );

  // 取景器实时画面；曝光期间把每一帧叠加成光迹预览
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    drawLive(ctx, W, H, camera.sceneSeed, doc.spot, camera.sceneClock, camera.settings);
    if (camera.shooting) {
      // 每一帧都是独立曝光：跨过帧界时重新累积
      if (accFrameRef.current !== camera.shooting.done) {
        accFrameRef.current = camera.shooting.done;
        accRef.current = null;
      }
      if (!accRef.current) {
        accRef.current = document.createElement("canvas");
        accRef.current.width = W;
        accRef.current.height = H;
      }
      const acc = accRef.current.getContext("2d")!;
      acc.globalAlpha = Math.min(0.7, (0.05 / camera.shooting.frameDur) * 2.5);
      acc.drawImage(canvas, 0, 0);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.drawImage(accRef.current, 0, 0);
      ctx.restore();
    } else {
      accRef.current = null;
      accFrameRef.current = -1;
    }
  }, [camera, doc.spot]);

  // 异步冲印：到点后把成片送回（迟到照片不会覆盖更晚选定的封面）
  const developing = [...camera.pending, ...doc.photos].filter((p) => !p.ready);
  const devKey = developing.map((p) => `${p.id}@${p.developAt}`).join(",");
  useEffect(() => {
    if (!developing.length) return;
    const timers = developing.map((p) =>
      window.setTimeout(
        () => send({ type: "frame-developed", id: p.id }),
        Math.max(30, p.developAt - Date.now()),
      ),
    );
    return () => timers.forEach((t) => clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devKey]);

  const download = async (p: Photo) => {
    // 明信片在 canvas 上写中文；网页字体按字符子集加载，先点名所需字符
    const sample =
      "静水手记清晰识别镜头目击水下明信片曝光对焦采样第张共银鲫河鲈锦鲤虹鳟大口黑白斑狗芦苇浅湾青石溪流镜深";
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load("600 40px 'Noto Serif SC'", sample),
          document.fonts.load("600 26px 'Noto Serif SC'", sample),
          document.fonts.load("24px 'Noto Sans SC'", sample),
        ]),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    } catch {
      /* 字体不可用时使用系统字体 */
    }
    renderPostcard(p).toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stillwater-postcard-${p.id}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, "image/png");
  };

  const progress = sh
    ? Math.min(1, Math.max(0, (camera.sceneClock - sh.start) / (sh.frames * sh.frameDur)))
    : 0;

  return (
    <section className="camera-panel" id="camera">
      <div className="section-title">
        <Camera size={17} />
        <h2>水下摄影机</h2>
        <span>
          {water(doc.spot).name} · 记录 {(est / 1048576).toFixed(1)} / 2 MB
        </span>
      </div>
      <div className="camera-body">
        <div className="viewfinder">
          <canvas ref={ref} width={W} height={H} aria-label="水下取景器实时画面" />
          <div className="vf-hud">
            <span>
              <Scan size={11} />
              {s.focal}mm
            </span>
            <span>对焦 {s.focus.toFixed(1)}m</span>
            <span>转向 {s.pan > 0 ? `+${s.pan}` : s.pan}°</span>
          </div>
          {sh && (
            <div className="vf-rec" role="status">
              <i />
              曝光中 · 第 {Math.min(sh.frames, sh.done + 1)}/{sh.frames} 张
              <progress max={1} value={progress} />
            </div>
          )}
          {!sh && camera.pending.length > 0 && (
            <div className="vf-hint">本组拍摄完成，在下方回看并采纳照片</div>
          )}
        </div>
        <div className="cam-controls">
          <label>
            焦距 <output>{s.focal} mm</output>
            <input
              type="range"
              min={24}
              max={85}
              step={1}
              value={s.focal}
              aria-label="焦距"
              onChange={(e) => send({ type: "cam-set", patch: { focal: +e.target.value } })}
            />
          </label>
          <label>
            对焦距离 <output>{s.focus.toFixed(1)} m</output>
            <input
              type="range"
              min={0.5}
              max={8}
              step={0.1}
              value={s.focus}
              aria-label="对焦距离"
              onChange={(e) => send({ type: "cam-set", patch: { focus: +e.target.value } })}
            />
          </label>
          <label>
            镜头转向 <output>{s.pan}°</output>
            <span className="pan-row">
              <button
                className="icon-btn"
                aria-label="向左转动镜头"
                onClick={() => send({ type: "cam-set", patch: { pan: s.pan - 5 } })}
              >
                <ChevronLeft size={15} />
              </button>
              <input
                type="range"
                min={-40}
                max={40}
                step={1}
                value={s.pan}
                aria-label="镜头转向"
                onChange={(e) => send({ type: "cam-set", patch: { pan: +e.target.value } })}
              />
              <button
                className="icon-btn"
                aria-label="向右转动镜头"
                onClick={() => send({ type: "cam-set", patch: { pan: s.pan + 5 } })}
              >
                <ChevronRight size={15} />
              </button>
            </span>
          </label>
          <label>
            曝光时间{s.mode === "burst" ? "（每张）" : ""} <output>{s.exposure.toFixed(1)} s</output>
            <input
              type="range"
              min={0.5}
              max={20}
              step={0.5}
              value={s.exposure}
              disabled={!!sh}
              aria-label="曝光时间"
              onChange={(e) => send({ type: "cam-set", patch: { exposure: +e.target.value } })}
            />
          </label>
          <label>
            采样精度 <output>{s.precision} ms</output>
            <input
              type="range"
              min={0}
              max={PRECISION_STEPS.length - 1}
              step={1}
              value={precisionIdx}
              disabled={!!sh}
              aria-label="采样精度"
              onChange={(e) =>
                send({ type: "cam-set", patch: { precision: PRECISION_STEPS[+e.target.value] } })
              }
            />
          </label>
          <div className="budget">
            <span>
              连拍记录 {(est / 1048576).toFixed(2)} / 2 MB
            </span>
            <progress max={RECORD_BUDGET} value={Math.min(est, RECORD_BUDGET)} />
          </div>
          {over && (
            <p className="cam-warn" role="alert">
              记录将超出 2 MB 上限。
              {sustain ? (
                <>
                  当前设置可维持 <b>{sustain} ms</b> 精度。
                  <button
                    className="text-btn"
                    onClick={() => send({ type: "cam-set", patch: { precision: sustain } })}
                  >
                    调整为 {sustain} ms
                  </button>
                </>
              ) : (
                "请缩短曝光时间或减少连拍张数。"
              )}
            </p>
          )}
          <div className="mini-tabs cam-mode">
            <button
              className={s.mode === "single" ? "active" : ""}
              disabled={!!sh}
              onClick={() => send({ type: "cam-set", patch: { mode: "single" } })}
            >
              <Timer size={13} />
              单张长曝光
            </button>
            <button
              className={s.mode === "burst" ? "active" : ""}
              disabled={!!sh}
              onClick={() => send({ type: "cam-set", patch: { mode: "burst" } })}
            >
              <Images size={13} />
              连拍 ×{s.burst}
            </button>
          </div>
          {s.mode === "burst" && (
            <label>
              连拍张数
              <output>
                {s.burst} 张 · 每张 {frameDur.toFixed(1)}s · 共 {totalTime.toFixed(1)}s
              </output>
              <input
                type="range"
                min={2}
                max={12}
                step={1}
                value={s.burst}
                disabled={!!sh}
                aria-label="连拍张数"
                onChange={(e) => send({ type: "cam-set", patch: { burst: +e.target.value } })}
              />
            </label>
          )}
          <p className="cam-hint">
            长曝光把整段游动累积成连续光迹，连拍短曝光则逐张定格瞬间——同一片鱼群，两种画面。
            曝光期间仍可转动镜头；采样越密越能抓住水草间快速穿过的遮挡，记录也越接近 2 MB 上限。
          </p>
          <div className="action-row">
            <span className="control-tip">
              <Aperture size={14} />
              拍照不算捕获，也不消耗鱼饵
            </span>
            {sh ? (
              <button className="primary" onClick={() => send({ type: "cam-cancel" })}>
                停止曝光
              </button>
            ) : (
              <button className="primary" disabled={over} onClick={() => send({ type: "cam-shutter" })}>
                <Aperture size={16} />
                按下快门{frames > 1 ? ` · ${frames} 连拍` : ""}
              </button>
            )}
          </div>
        </div>
      </div>
      {camera.pending.length > 0 && (
        <div className="photo-tray">
          <div className="tray-head">
            <strong>连拍回看 · {camera.pending.length} 张</strong>
            <button className="text-btn" onClick={() => send({ type: "tray-close" })}>
              <Trash2 size={12} />
              结束连拍，释放未采纳画面
            </button>
          </div>
          <div className="tray-grid">
            {camera.pending.map((p) => (
              <figure key={p.id}>
                <PhotoView photo={p} />
                <Chips photo={p} />
                <figcaption>
                  <button
                    className="text-btn"
                    onClick={() => send({ type: "photo-accept", id: p.id, cover: false })}
                  >
                    <ImagePlus size={12} />
                    采纳
                  </button>
                  <button
                    className="text-btn"
                    onClick={() => send({ type: "photo-accept", id: p.id, cover: true })}
                  >
                    采纳并设为封面
                  </button>
                  <button className="text-btn" disabled={!p.ready} onClick={() => download(p)}>
                    <Download size={12} />
                    明信片
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="tray-note">
            识别结论以整段曝光记录为准，不看单一帧；未采纳的画面将在下次按下快门或结束连拍时释放。
          </p>
        </div>
      )}
      <div className="photo-album">
        <div className="tray-head">
          <strong>
            相册 · {doc.photos.length}/{ALBUM_MAX}
          </strong>
          <span className="muted">采纳的照片保存在本地手记</span>
        </div>
        {doc.photos.length === 0 ? (
          <p className="album-empty">还没有采纳的照片。调好焦距与对焦，按下快门吧。</p>
        ) : (
          <div className="tray-grid">
            {doc.photos.map((p) => (
              <figure key={p.id} className={doc.cover?.photoId === p.id ? "is-cover" : ""}>
                <PhotoView photo={p} />
                {doc.cover?.photoId === p.id && <span className="cover-badge">图鉴封面</span>}
                {p.coverWhenReady !== undefined && (
                  <span className="cover-badge pending">冲印后设为封面</span>
                )}
                <Chips photo={p} />
                <figcaption>
                  <button
                    className="text-btn"
                    disabled={doc.cover?.photoId === p.id}
                    onClick={() => send({ type: "photo-cover", id: p.id })}
                  >
                    设为封面
                  </button>
                  <button className="text-btn" disabled={!p.ready} onClick={() => download(p)}>
                    <Download size={12} />
                    明信片
                  </button>
                  <button className="text-btn" onClick={() => send({ type: "photo-remove", id: p.id })}>
                    移除
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
