(function() {
    'use strict';

    let activeVideo = null;
    const btn = document.createElement('div');
    btn.className = 'yt-dlm-mini-btn';
    btn.innerHTML = '<i class="fas fa-arrow-down"></i> IDM ile İndir';
    
    // Check if FontAwesome is needed (YouTube usually doesn't have it)
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    document.head.appendChild(link);
    document.body.appendChild(btn);

    function showButton(video) {
        if (!video || video.offsetWidth < 100) return;
        activeVideo = video;
        const rect = video.getBoundingClientRect();
        btn.style.top = (window.scrollY + rect.top + 10) + 'px';
        btn.style.left = (window.scrollX + rect.left + rect.width - 150) + 'px';
        btn.classList.add('visible');
    }

    document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (target.tagName === 'VIDEO') {
            showButton(target);
        } else if (target === btn) {
            // Keep
        }
    }, true);

    // Click logic
    btn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        const videoUrl = window.location.href;
        btn.innerHTML = '<i></i> Gönderiliyor...';

        fetch("http://localhost:3000/api/info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: videoUrl })
        })
        .then(res => res.json())
        .then(info => {
             if (info.error) throw new Error(info.error);
             return fetch("http://localhost:3000/api/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: videoUrl, title: info.title })
             });
        })
        .then(() => {
            btn.innerHTML = 'Kuyruğa Eklendi!';
            setTimeout(() => {
                btn.innerHTML = '<i class="fas fa-arrow-down"></i> IDM ile İndir';
                btn.classList.remove('visible');
            }, 3000);
        })
        .catch(err => {
            alert('YT-DLM Sunucusuna ulaşılamadı. Lütfen uygulamayı açın.');
            btn.innerHTML = '<i class="fas fa-arrow-down"></i> IDM ile İndir';
        });
    };
})();
