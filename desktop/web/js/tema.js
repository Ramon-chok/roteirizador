/* Route VORTEX — temas visuais do aplicativo.
   Roda no <head>, antes da página aparecer, para não piscar o tema errado.
   Só mexe no visual: grava a escolha neste dispositivo e troca o atributo data-theme do <html>.
   O mapa acompanha sozinho (app.js observa o data-theme e troca o fundo claro/escuro). */
(function () {
  'use strict';
  var CHAVE = 'rvx:tema';
  var PADRAO = 'dark';
  var TEMAS = [
    { id: 'dark', nome: 'Escuro', desc: 'Navy Vortex', cores: ['#0B1426', '#22D3EE', '#3B82F6', '#F97316'] },
    { id: 'black', nome: 'Preto e branco', desc: 'Preto absoluto e cinza', cores: ['#000000', '#F5F5F5', '#A3A3A3', '#292929'] },
    { id: 'light', nome: 'Claro', desc: 'Fundo claro', cores: ['#F5F8FC', '#0B1426', '#2563EB', '#F97316'] },
    { id: 'mono', nome: 'Monocromático', desc: 'Azul e branco', cores: ['#1D4ED8', '#FFFFFF', '#FFFFFF', '#FFFFFF'] },
    { id: 'vertical', nome: 'Vertical', desc: 'Noite', cores: ['#111D35', '#E8F1FF', '#3B82F6', '#22D3EE'] },
    { id: 'auto', nome: 'Automático', desc: 'Segue o sistema', cores: ['#F5F8FC', '#0B1426', '#22D3EE', '#3B82F6'] }
  ];
  var ids = TEMAS.map(function (t) { return t.id; });

  function ler() { try { var v = localStorage.getItem(CHAVE); return ids.indexOf(v) >= 0 ? v : PADRAO; } catch (e) { return PADRAO; } }
  function aplicar(id) {
    var h = document.documentElement;
    if (id === 'auto') h.removeAttribute('data-theme'); else h.setAttribute('data-theme', id);
    h.setAttribute('data-tema', id);
  }
  function atual() { return document.documentElement.getAttribute('data-tema') || ler(); }
  function definir(id) {
    if (ids.indexOf(id) < 0) return;
    try { localStorage.setItem(CHAVE, id); } catch (e) { /* vale só nesta sessão */ }
    aplicar(id); marcar();
  }
  aplicar(ler());

  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function amostra(t) {
    var c = t.cores;
    return '<span class="tema-sw" aria-hidden="true" style="background:' + c[0] + '"><i style="background:' + c[1] + '"></i><i style="background:' + c[2] + '"></i><i style="background:' + c[3] + '"></i></span>';
  }
  /* Opções em cartões (página Configurações) */
  function opcoesHtml() {
    var a = atual();
    return TEMAS.map(function (t) {
      return '<button type="button" class="tema-op" data-tema="' + t.id + '" role="radio" aria-checked="' + (t.id === a) + '">' + amostra(t) +
        '<span class="tema-tx"><b>' + esc(t.nome) + '</b><span>' + esc(t.desc) + '</span></span></button>';
    }).join('');
  }
  function marcar() {
    var a = atual();
    var bs = document.querySelectorAll('[data-tema]');
    for (var i = 0; i < bs.length; i++) if (bs[i] !== document.documentElement) bs[i].setAttribute('aria-checked', String(bs[i].getAttribute('data-tema') === a));
  }

  /* Menu rápido na barra superior */
  var ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/></svg>';
  function montarMenu() {
    var conta = document.getElementById('acctBtn');
    if (!conta || document.getElementById('temaBtn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'temaBtn'; b.className = 'tema-btn';
    b.title = 'Tema do aplicativo'; b.setAttribute('aria-label', 'Tema do aplicativo');
    b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false');
    b.innerHTML = ICONE;
    conta.parentNode.insertBefore(b, conta);
    var m = document.createElement('div');
    m.id = 'temaMenu'; m.className = 'float'; m.hidden = true; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'Tema do aplicativo');
    document.body.appendChild(m);
    function fechar() { m.hidden = true; b.setAttribute('aria-expanded', 'false'); }
    function abrir() {
      var a = atual();
      m.innerHTML = '<div class="ctx-h">Tema do aplicativo</div>' + TEMAS.map(function (t) {
        return '<button type="button" role="menuitemradio" data-tema="' + t.id + '" aria-checked="' + (t.id === a) + '">' + amostra(t) + '<span class="tema-tx"><b>' + esc(t.nome) + '</b><span>' + esc(t.desc) + '</span></span></button>';
      }).join('');
      m.hidden = false; b.setAttribute('aria-expanded', 'true');
      var r = b.getBoundingClientRect();
      m.style.top = (r.bottom + 6) + 'px';
      m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px';
      var sel = m.querySelector('[aria-checked="true"]'); if (sel) sel.focus();
    }
    b.addEventListener('click', function (e) { e.stopPropagation(); if (m.hidden) abrir(); else fechar(); });
    document.addEventListener('click', function (e) { if (!m.hidden && !m.contains(e.target) && e.target !== b) fechar(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !m.hidden) { fechar(); b.focus(); } });
    addEventListener('resize', fechar);
    m.addEventListener('click', function (e) { var t = e.target.closest('[data-tema]'); if (t) { definir(t.getAttribute('data-tema')); fechar(); } });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.tema-op[data-tema]');
    if (t) definir(t.getAttribute('data-tema'));
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarMenu); else montarMenu();

  window.RVXTema = { temas: TEMAS, atual: atual, definir: definir, opcoesHtml: opcoesHtml };
})();
