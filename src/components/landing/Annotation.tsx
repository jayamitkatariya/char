// The handwritten note above the hero window: the words reveal left→right
// (clip-path), then the looping arrow draws itself (stroke-dashoffset). Pure
// CSS, so it stays a server component; reduced motion just shows it.
export default function Annotation() {
  return (
    <div className="annotation" aria-hidden="true">
      <span className="annotation-text">apple notes that actually helps!</span>
      <svg className="annotation-arrow" viewBox="0 0 120 120" fill="none">
        <path
          className="annotation-stroke"
          pathLength={1}
          d="M6 14c22-8 52-8 66 6 13 13 8 33-7 33-14 0-15-20 1-25 18-6 33 9 32 31-1 24-14 43-36 54"
        />
        <path className="annotation-head" pathLength={1} d="M77 116c-5-2-10-3-15-3 3-4 5-8 7-12" />
      </svg>
    </div>
  );
}
