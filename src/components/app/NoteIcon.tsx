"use client";

import { useEffect, useRef, useState } from "react";
import { IconNote } from "../icons";

/** A page's emoji, or the plain page icon. */
export function NoteIcon({ icon, size = 14, className = "" }: { icon?: string | null; size?: number; className?: string }) {
  if (!icon) return <IconNote size={size} className={className} />;
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center leading-none ${className}`}
      style={{ width: size + 2, height: size + 2, fontSize: size }}
    >
      {icon}
    </span>
  );
}

const EMOJI = (
  "📝 📄 📓 📒 📚 📌 📎 🗂️ 🗒️ 📅 🗓️ ✅ ☑️ ⭐ 💡 🔥 🚀 🎯 🏁 🧭 " +
  "💼 🏢 💰 📈 📊 🧾 🛒 🏠 🏡 🌱 🌿 🌸 🍳 ☕ 🍎 🏋️ 🧘 🏃 ✈️ 🗺️ " +
  "🎒 🏖️ 🎨 🎵 🎬 📷 🎮 🧩 🧠 ❤️ 🙂 🎉 🎁 👶 🐶 🐱 🔧 🛠️ 💻 🖥️ " +
  "📱 🔒 🔑 ⚙️ 🧪 🔬 📐 ✏️ 🖊️ 🗣️ 💬 📣 ✉️ 📦 🌍 ☀️ 🌙 ⏰ ⌛ 🧹"
).split(" ");

/** A small emoji grid. Typing filters nothing (emoji have no names here); it's a quick pick. */
export function IconPicker({ onPick, onRemove, onClose, hasIcon }: { onPick: (e: string) => void; onRemove: () => void; onClose: () => void; hasIcon: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");
  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="dialog" aria-label="Choose an icon" className="card pop-in absolute left-0 top-full z-40 mt-2 w-[324px] p-2">
      <div className="mb-1 flex items-center gap-2 px-1">
        <span className="label flex-1">icon</span>
        {hasIcon && (
          <button className="btn btn-ghost btn-sm" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      <div className="grid grid-cols-10 gap-0.5">
        {EMOJI.map((e) => (
          <button key={e} className="row flex h-[30px] w-[30px] items-center justify-center text-[18px]" onClick={() => onPick(e)} aria-label={`Use ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-1.5 px-1 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          const v = [...new Intl.Segmenter().segment(custom.trim())][0]?.segment;
          if (v) onPick(v);
        }}
      >
        <input
          className="input !py-1.5 !text-[13px]"
          placeholder="Or type any emoji (⌃⌘Space)"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <button className="btn btn-sm" type="submit" disabled={!custom.trim()}>
          Use
        </button>
      </form>
    </div>
  );
}
