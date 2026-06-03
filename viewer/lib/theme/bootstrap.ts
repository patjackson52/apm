// Inline <script> (nonce'd) that sets data-theme before paint to avoid FOUC.
export const THEME_BOOTSTRAP =
  "(function(){try{var t=localStorage.getItem('apm-theme')||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;}catch(e){}})()";
