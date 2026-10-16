// Runs before React (inlined by the notes layout), so the splash and first paint are already in
// the right colours. src/lib/theme.ts takes over once the app starts.

export const THEME_KEY = "char:theme";

export const THEME_BOOT = `try{var m=localStorage.getItem("${THEME_KEY}")||"system";var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}`;
