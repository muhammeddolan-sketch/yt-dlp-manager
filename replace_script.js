const fs = require('fs');

// content.css
let css = fs.readFileSync('/home/slawn/Projeler/yt-dlp-manager/web-extension/content.css', 'utf8');
css = css.replace('transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);', 'transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease !important;\n    opacity: 0.3 !important;');
css = css.replace('.yt-dlm-mini-btn:hover {\n    transform: translateY(-2px)', '.yt-dlm-mini-btn:hover {\n    opacity: 1 !important;\n    transform: translateY(-2px)');
fs.writeFileSync('/home/slawn/Projeler/yt-dlp-manager/web-extension/content.css', css);

// content.js
let js = fs.readFileSync('/home/slawn/Projeler/yt-dlp-manager/web-extension/content.js', 'utf8');
js = js.replace("btn.style.left = Math.round(rect.left + rect.width - 120) + 'px';", "btn.style.left = Math.round(rect.left + (rect.width / 2) - 50) + 'px';");
fs.writeFileSync('/home/slawn/Projeler/yt-dlp-manager/web-extension/content.js', js);
console.log('done!');
