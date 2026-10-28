window.__ModuleLoader__.load({
  id: 'dsh-yunxiao-taskboard',
  factory(require) {
    const React = require('react')
    const { useEffect, useState } = React
    const h = React.createElement
    const SPACE_KEY = 'yunxiao.spaceId'
    // 状态列颜色按名字取；云端改状态名就回落到默认灰
    const STATUS_COLORS = {
      待处理: '#b4791f', 待确认: '#b4791f', 再次打开: '#c2543f',
      设计中: '#2f6bb8', 开发中: '#2f6bb8', 测试中: '#5f7fb0', 处理中: '#2f6bb8',
      已完成: '#2f8a5f', 已修复: '#2f8a5f',
      已取消: '#8a8a8a', 已关闭: '#8a8a8a', 暂不修复: '#8a8a8a',
    }
    const PRIORITY_COLORS = { 紧急: '#bd5f4e', 高: '#c98d4a', 中: '#5e7fa6', 低: '#b0a894' }
    const PRIORITIES = [{ id: 'urgent', label: '紧急' }, { id: 'high', label: '高' }, { id: 'medium', label: '中' }, { id: 'low', label: '低' }]
    // 只有还没进入流程的状态才给「处理」入口
    const OPEN_STATUSES = new Set(['待处理', '待确认', '再次打开'])
    const PHASE_LABEL = { Req: { start: '开发中', pushed: '测试中' }, Bug: { start: '处理中', pushed: '已修复' } }

    function Icon() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': true,
      }, h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }), h('path', { d: 'M8 7v10M12 7v6M16 7v8' }))
    }

    async function rpc(method, args) {
      const response = await fetch('/api/yunxiao-taskboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args }),
      })
      const payload = await response.json()
      if (!payload.ok) throw new Error(payload.error || '请求失败')
      return payload.value
    }

    function formatTime(value, dateOnly) {
      if (value == null || value === '') return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      // 非本年日期带上年份，否则看不出是哪年；卡片上跨年日期只留日期，详情里仍给完整时间
      if (date.getFullYear() !== new Date().getFullYear()) {
        const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        return dateOnly ? day : `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
      }
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function emptyText(error, columns, q) {
      const message = error?.message || ''
      if (message.includes('令牌')) return '未配置云效令牌，请在插件设置里填写'
      if (message.includes('组织 ID')) return '未配置组织 ID，请在插件设置里填写'
      if (error) return message
      if (!columns) return ''
      if (columns.reduce((n, col) => n + col.cards.length, 0)) return ''
      return q ? '没有匹配的工作项' : '这里还没有工作项'
    }

    function Card({ card, statuses, error, workspaces, canProcess, pickerOpen, dragging, onLoadStatuses, onToggleWorkspaces, onProcess, onMove, onOpen, onDragStart, onDragEnd }) {
      const [hover, setHover] = useState(false)
      // 操作按钮平时隐藏、Hover 显现；展开下拉时强制可见，避免无处可点
      const showActions = hover || statuses || pickerOpen
      const actionStyle = {
        cursor: 'pointer', border: 0, background: 'transparent', padding: '1px 2px',
        fontSize: 11.5, color: hover ? '#5c5346' : '#8a8172', borderRadius: 4,
        opacity: showActions ? 1 : 0, transition: 'opacity .12s ease, color .12s ease',
      }
      return h('article', {
        draggable: true,
        style: {
          background: '#fff',
          // 不能用 border 简写 + borderLeft：hover 重设简写会把左边框复位掉（React 只重设变化的值）
          borderTop: `1px solid ${hover ? '#d8cfbd' : '#e9e4da'}`,
          borderRight: `1px solid ${hover ? '#d8cfbd' : '#e9e4da'}`,
          borderBottom: `1px solid ${hover ? '#d8cfbd' : '#e9e4da'}`,
          borderLeft: `3px solid ${card.statusColor || '#c8c2b6'}`,
          borderRadius: 8,
          padding: '8px 8px',
          marginBottom: 8,
          cursor: 'grab',
          opacity: dragging ? 0.45 : 1,
          transition: 'border-color .12s ease, opacity .12s ease',
        },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onClick: () => onOpen(card),
        onDragStart: (event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', card.id)
          onDragStart(card)
        },
        onDragEnd: onDragEnd,
      },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, marginBottom: 4 } },
          h('span', { style: { font: '500 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace', color: '#948b7c', whiteSpace: 'nowrap', flex: 'none' } }, card.serialNumber), // taste-skill-ignore: 工作项编号用等宽字体，扫视对齐（app-screens ID 规范）
          h('span', { style: { position: 'relative', flex: '1 1 auto', minWidth: 0, textAlign: 'right' } },
            h('span', { style: { display: 'block', fontSize: 11, lineHeight: 1.4, color: '#a89c88', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums', opacity: showActions ? 0 : 1, transition: 'opacity .12s ease' } }, formatTime(card.updatedAt, true)),
            h('span', {
              style: {
                position: 'absolute', right: 0, top: 0, display: 'inline-flex', gap: 2,
                opacity: showActions ? 1 : 0, transition: 'opacity .12s ease',
                pointerEvents: showActions ? 'auto' : 'none',
              },
            },
              h('button', {
                type: 'button',
                onClick: (event) => { event.stopPropagation(); onLoadStatuses(card) },
                style: actionStyle,
              }, statuses ? '收起' : '流转'),
              canProcess ? h('button', {
                type: 'button',
                onClick: (event) => { event.stopPropagation(); onToggleWorkspaces(card) },
                style: actionStyle,
              }, pickerOpen ? '取消' : '处理') : null))),
        h('div', {
          style: {
            fontSize: 13, lineHeight: 1.45, fontWeight: 600, color: '#1f1c18', wordBreak: 'break-word',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          },
        }, card.subject || '(无标题)'),
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 } },
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#8a8172', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } },
            h('span', {
              style: { width: 16, height: 16, flex: 'none', borderRadius: '50%', background: '#f0ece3', display: 'inline-grid', placeItems: 'center', fontSize: 9.5, color: '#948b7c' },
            }, (card.assignee || '?').slice(0, 1)),
            card.assignee || '未分配'),
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' } },
            card.priority ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#8a8172' } },
              h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLORS[card.priority] || '#b0a894' } }),
              card.priority) : null)),
        pickerOpen ? h('select', {
          value: '',
          autoFocus: true,
          onClick: (event) => event.stopPropagation(),
          onChange: (event) => event.target.value && onProcess(card, event.target.value),
          style: { marginTop: 6, width: '100%', border: '1px solid #e6e2d9', borderRadius: 6, padding: '5px 8px', fontSize: 12, background: '#fff' },
        },
          h('option', { value: '' }, workspaces.length ? '选择工作区' : '没有可用的工作区'),
          workspaces.map((workspace) => h('option', { key: workspace.workspaceId, value: workspace.workspaceId },
            `${workspace.title} · ${workspace.path.split('/').slice(-1)[0]}`))) : null,
        statuses ? h('select', {
          value: '',
          onClick: (event) => event.stopPropagation(),
          onChange: (event) => event.target.value && onMove(card, event.target.value),
          style: { marginTop: 6, width: '100%', border: '1px solid #e6e2d9', borderRadius: 6, padding: '5px 8px', fontSize: 12, background: '#fff' },
        },
          h('option', { value: '' }, '选择目标状态'),
          statuses.map((status) => h('option', { key: status.id, value: status.id }, status.name))) : null,
        error ? h('div', { style: { marginTop: 6, fontSize: 11.5, color: '#a3342b', background: '#fdf1ef', borderRadius: 6, padding: '4px 8px' } }, error) : null)
    }

    // 云效描述是富文本（含内联图片）。只保留排版标签，去掉脚本类节点和事件属性。
    const RICH_TAGS = new Set([
      'P', 'DIV', 'SPAN', 'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUB', 'SUP',
      'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'COLGROUP', 'COL',
      'A', 'IMG', 'FIGURE', 'FIGCAPTION',
    ])
    const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON'])
    const KEEP_ATTRS = new Set([
      'href', 'src', 'alt', 'title', 'style', 'width', 'height',
      'colspan', 'rowspan', 'align', 'valign', 'target', 'rel', 'loading',
    ])

    function sanitizeHtml(html) {
      if (!html) return ''
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
      const clean = (node) => {
        for (const child of [...node.children]) {
          if (DROP_TAGS.has(child.tagName)) { child.remove(); continue }
          if (!RICH_TAGS.has(child.tagName)) {
            clean(child)
            child.replaceWith(...child.childNodes)
            continue
          }
          for (const attribute of [...child.attributes]) {
            const name = attribute.name.toLowerCase()
            if (name.startsWith('on') || !KEEP_ATTRS.has(name)) child.removeAttribute(attribute.name)
            else if ((name === 'href' || name === 'src') && !/^(https?:\/\/|\/|#)/i.test(attribute.value.trim())) child.removeAttribute(attribute.name)
          }
          if (child.tagName === 'A') {
            child.setAttribute('target', '_blank')
            child.setAttribute('rel', 'noreferrer')
          }
          if (child.tagName === 'IMG') {
            child.setAttribute('loading', 'lazy')
            child.style.maxWidth = '100%'
            child.style.height = 'auto'
            child.style.borderRadius = '6px'
            child.style.cursor = 'zoom-in'
          }
          if (['TD', 'TH'].includes(child.tagName)) {
            child.style.border = child.style.border || '1px solid #eae5da'
            child.style.padding = child.style.padding || '4px 8px'
          }
          clean(child)
        }
      }
      clean(doc.body)
      return doc.body.innerHTML
    }

    function formatSize(bytes) {
      if (!bytes && bytes !== 0) return ''
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    function Detail({ serial, detail, error, onClose }) {
      const bodyRef = React.useRef(null)
      const previewRef = React.useRef(null)
      const [preview, setPreview] = useState(null)

      useEffect(() => { previewRef.current = preview }, [preview])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (previewRef.current) { setPreview(null); return }
          onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      // 图片没登录云效会 401：换成可点的占位，不留破图
      useEffect(() => {
        const root = bodyRef.current
        if (!root) return
        const cleanups = []
        for (const image of root.querySelectorAll('img')) {
          const fail = () => {
            // 拿不到图就不要留任何可下载入口，只给一句提示
            const box = document.createElement('span')
            box.textContent = '图片需在云效网页登录后查看'
            box.style.cssText = 'display:inline-block;padding:6px 10px;border:1px dashed #d8cfbd;border-radius:6px;color:#a89c88;font-size:12px'
            image.replaceWith(box)
            image.removeEventListener('error', fail)
          }
          image.addEventListener('error', fail)
          cleanups.push(() => image.removeEventListener('error', fail))
        }
        return () => cleanups.forEach((fn) => fn())
      }, [detail])

      // 点描述里的图 → 弹层预览，不跳转、不下载
      function openPreview(event) {
        const image = event.target.closest?.('img')
        if (!image) return
        event.preventDefault()
        event.stopPropagation()
        setPreview(image.currentSrc || image.src)
      }

      const rows = detail ? [
        ['状态', detail.status],
        ['优先级', detail.priority],
        ['负责人', detail.assignee || '未分配'],
        ['创建人', detail.creator],
        ['类型', detail.type],
        ['项目', detail.space],
        ['创建', formatTime(detail.createdAt)],
        ['更新', formatTime(detail.updatedAt)],
      ].filter(([, value]) => value) : []

      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end',
          background: 'rgba(35,30,22,.22)', backdropFilter: 'blur(1px)',
        },
        onClick: onClose,
      },
        h('aside', {
          onClick: (event) => event.stopPropagation(),
          style: {
            width: 920, maxWidth: '92vw', height: '100%', background: '#fff', borderLeft: '1px solid #eae5da',
            boxShadow: '-8px 0 28px rgba(50,40,25,.14)', display: 'flex', flexDirection: 'column',
            font: '14px/1.55 system-ui, -apple-system, "PingFang SC", sans-serif', color: '#22201c',
          },
        },
          h('header', {
            style: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid #f0ece3' },
          },
            h('span', { style: { font: '600 12px/1.4 ui-monospace, Menlo, monospace', color: '#8a7f6b' } }, serial), // taste-skill-ignore: 工作项编号用等宽字体，扫视对齐（app-screens ID 规范）
            h('span', { style: { flex: 1 } }),
            h('button', {
              type: 'button', onClick: onClose, title: '关闭',
              style: {
                border: '1px solid #e6e2d9', background: '#fff', color: '#776c5b', cursor: 'pointer',
                borderRadius: 7, width: 28, height: 28, fontSize: 15, lineHeight: 1,
              },
            }, '×')),
          h('div', { style: { padding: 16, overflowY: 'auto', flex: 1 } },
            error ? h('div', { style: { color: '#a3342b', background: '#fdf1ef', borderRadius: 8, padding: '8px 10px', fontSize: 13 } }, error.message) : null,
            detail ? h('div', null,
              h('h2', { style: { margin: '0 0 14px', fontSize: 16.5, lineHeight: 1.45, fontWeight: 650 } }, detail.subject || '(无标题)'),
              h('dl', {
                style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '7px 14px', margin: '0 0 16px', fontSize: 13 },
              },
                rows.flatMap(([label, value]) => [
                  h('dt', { key: `k-${label}`, style: { color: '#a1937c' } }, label),
                  h('dd', { key: `v-${label}`, style: { margin: 0, color: '#3f382e' } }, value),
                ])),
              h('div', { style: { fontSize: 12, color: '#a1937c', marginBottom: 6 } }, '描述'),
              h('div', {
                ref: bodyRef,
                onClick: openPreview,
                style: {
                  wordBreak: 'break-word', fontSize: 13.5, color: '#3f382e', lineHeight: 1.65,
                  background: '#faf8f3', border: '1px solid #f0ece3', borderRadius: 8, padding: '10px 12px',
                  overflowX: 'auto',
                },
                dangerouslySetInnerHTML: {
                  __html: detail.descriptionHtml
                    ? sanitizeHtml(detail.descriptionHtml)
                    : (detail.description ? `<p style="white-space:pre-wrap;margin:0">${detail.description.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>` : '<p style="margin:0">（无描述）</p>'),
                },
              }),
              detail.attachments && detail.attachments.length ? h('div', null,
                h('div', { style: { fontSize: 12, color: '#a1937c', margin: '16px 0 6px' } }, `附件 ${detail.attachments.length}`),
                detail.attachments.map((file) => h(file.url ? 'a' : 'div', {
                  key: file.id,
                  href: file.url || undefined, target: file.url ? '_blank' : undefined, rel: file.url ? 'noreferrer' : undefined,
                  style: {
                    display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none',
                    border: '1px solid #f0ece3', borderRadius: 8, padding: '8px 10px', marginBottom: 6,
                    color: file.url ? '#3f382e' : '#a1937c', cursor: file.url ? 'pointer' : 'default',
                  },
                },
                  h('span', { style: { fontSize: 15 } }, '📎'), // taste-skill-ignore: 附件行的文件图标，无图标库可用
                  h('span', { style: { flex: 1, fontSize: 13, wordBreak: 'break-all' } }, file.name),
                  h('span', { style: { fontSize: 11.5, color: '#a1937c' } }, formatSize(file.size))))) : null)
            : (!error ? h('div', { style: { color: '#a89c88', fontSize: 13 } }, '加载中…') : null))),
        preview ? h('div', {
          onClick: (event) => { event.stopPropagation(); setPreview(null) },
          style: {
            position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(20,17,12,.82)',
            display: 'grid', placeItems: 'center', padding: 24, cursor: 'zoom-out',
          },
        },
          h('img', {
            src: preview, alt: '预览',
            style: { maxWidth: '94vw', maxHeight: '92vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 12px 40px rgba(0,0,0,.45)' },
          }),
          h('button', {
            type: 'button', onClick: (event) => { event.stopPropagation(); setPreview(null) }, title: '关闭预览',
            style: {
              position: 'fixed', top: 18, right: 20, border: '1px solid rgba(255,255,255,.35)', background: 'rgba(255,255,255,.12)',
              color: '#fff', borderRadius: 8, width: 32, height: 32, fontSize: 17, cursor: 'pointer', lineHeight: 1,
            },
          }, '×')) : null)
    }

    function Settings({ initial, orgs, onSave, onClose }) {
      const [form, setForm] = useState({
        token: '',
        organizationId: initial.organizationId || '',
        baseUrl: initial.baseUrl || '',
        edition: initial.edition || '',
      })
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState(null)
      const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #e6e2d9', borderRadius: 7, padding: '7px 10px', fontSize: 13, outline: 'none' }

      function field(key, label, extra) {
        return h('label', { style: { display: 'block', marginBottom: 12 } },
          h('div', { style: { fontSize: 12, color: '#a1937c', marginBottom: 4 } }, label),
          h('input', {
            value: form[key],
            onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })),
            style: inputStyle,
            ...(extra || {}),
          }))
      }

      async function save() {
        setSaving(true)
        setError(null)
        try {
          await onSave(form)
        } catch (err) {
          setError(err.message)
        } finally {
          setSaving(false)
        }
      }

      return h('div', {
        style: { position: 'fixed', inset: 0, zIndex: 65, background: 'rgba(35,30,22,.28)', display: 'grid', placeItems: 'center', padding: 24 },
        onClick: onClose,
      },
        h('div', {
          onClick: (event) => event.stopPropagation(),
          style: {
            width: 460, maxWidth: '94vw', background: '#fff', borderRadius: 14, padding: 20,
            boxShadow: '0 18px 50px rgba(50,40,25,.24)',
            font: '14px/1.55 system-ui, -apple-system, "PingFang SC", sans-serif',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 14 } },
            h('div', { style: { fontSize: 15, fontWeight: 650 } }, '云效连接设置'),
            h('span', { style: { flex: 1 } }),
            h('button', {
              type: 'button', onClick: onClose, title: '关闭',
              style: { border: '1px solid #e6e2d9', background: '#fff', color: '#776c5b', borderRadius: 7, width: 28, height: 28, cursor: 'pointer', fontSize: 15 },
            }, '×')),
          field('token', `令牌${initial.hasToken ? '（已配置，留空不修改）' : ''}`, { type: 'password', placeholder: 'x-yunxiao-token' }),
          field('organizationId', '组织 ID（中心版必填，Region 版留空）'),
          field('baseUrl', 'API 域名（留空用默认 openapi-rdc.aliyuncs.com）'),
          h('label', { style: { display: 'block', marginBottom: 14 } },
            h('div', { style: { fontSize: 12, color: '#a1937c', marginBottom: 4 } }, '版本'),
            h('select', {
              value: form.edition,
              onChange: (event) => setForm((current) => ({ ...current, edition: event.target.value })),
              style: { ...inputStyle, background: '#fff' },
            },
              h('option', { value: '' }, '自动（有组织 ID 走中心版）'),
              h('option', { value: 'center' }, '中心版'),
              h('option', { value: 'region' }, 'Region 版'))),
          error ? h('div', { style: { color: '#a3342b', background: '#fdf1ef', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, marginBottom: 10 } }, error) : null,
          h('div', { style: { fontSize: 11.5, color: '#b3a893', marginBottom: 12 } }, `保存到 ${initial.store || '本地配置文件'}；未填的项回退到插件配置和环境变量。`),
          h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
            h('button', {
              type: 'button', onClick: onClose,
              style: { border: '1px solid #e6e2d9', background: '#fff', color: '#5c5346', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13 },
            }, '取消'),
            h('button', {
              type: 'button', onClick: save, disabled: saving,
              style: { border: 0, background: '#3f382e', color: '#fff', borderRadius: 8, padding: '7px 18px', cursor: saving ? 'default' : 'pointer', fontSize: 13, opacity: saving ? 0.7 : 1 },
            }, saving ? '保存中…' : '保存'))))
    }

    function Board({ ctx }) {
      const [projects, setProjects] = useState([])
      const [spaceId, setSpaceId] = useState(() => localStorage.getItem(SPACE_KEY) || '')
      const [category, setCategory] = useState('Req')
      const [draft, setDraft] = useState('')
      const [q, setQ] = useState('')
      const [priority, setPriority] = useState('')
      const [tick, setTick] = useState(0)
      const [assignee, setAssignee] = useState('')
      const [columns, setColumns] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(false)
      const [open, setOpen] = useState({})
      const [cardError, setCardError] = useState({})
      const [detail, setDetail] = useState(null)
      const [picker, setPicker] = useState(null)
      const [dragging, setDragging] = useState(null)
      const [dropTarget, setDropTarget] = useState(null)
      const [settings, setSettings] = useState(null)
      const [orgs, setOrgs] = useState({ organizations: [], organizationId: '', edition: '', error: null })
      const orgId = orgs.organizationId || ''
      const cardsById = new Map((columns || []).flatMap((col) => col.cards.map((card) => [card.id, card])))
      const workspaces = ctx.workspaces.list.getSnapshot().items

      useEffect(() => {
        const timer = setTimeout(() => setQ(draft.trim()), 300)
        return () => clearTimeout(timer)
      }, [draft])

      useEffect(() => {
        let stop = false
        rpc('projects', orgId || undefined).then((list) => {
          if (stop) return
          setProjects(list)
          setSpaceId((current) => {
            const keep = current && list.some((item) => item.id === current)
            const next = keep ? current : (list[0]?.id || '')
            if (next) localStorage.setItem(SPACE_KEY, next)
            return next
          })
        }).catch((err) => { if (!stop) setError(err) })
        return () => { stop = true }
      }, [orgs.organizationId])

      useEffect(() => {
        let stop = false
        rpc('organizations').then((data) => {
          if (!stop) setOrgs(data)
        }).catch(() => {})
        return () => { stop = true }
      }, [])

      useEffect(() => {
        if (!spaceId) return
        let stop = false
        setLoading(true)
        rpc('board', { spaceId, category, q, priority, orgId }).then((board) => {
          if (stop) return
          setColumns(board.columns)
          setError(null)
        }).catch((err) => {
          if (!stop) setError(err)
        }).finally(() => { if (!stop) setLoading(false) })
        return () => { stop = true }
      }, [spaceId, category, q, priority, tick, orgs.organizationId])

      function chooseSpace(id) {
        localStorage.setItem(SPACE_KEY, id)
        setSpaceId(id)
      }

      // 切换组织写回插件配置，会话里的 yunxiao 工具也跟着换组织
      async function chooseOrg(id) {
        if (!id || id === orgs.organizationId) return
        setLoading(true)
        setError(null)
        try {
          await rpc('saveSettings', { organizationId: id })
          setOrgs((current) => ({ ...current, organizationId: id }))
          setSpaceId('')
          setColumns(null)
          const list = await rpc('projects', orgId || undefined)
          setProjects(list)
          const next = list[0]?.id || ''
          if (!next) {
            setLoading(false)
            setError(new Error('这个组织下没有可访问的项目'))
            return
          }
          localStorage.setItem(SPACE_KEY, next)
          setSpaceId(next)
        } catch (err) {
          setLoading(false)
          setError(err)
        }
      }

      async function showStatuses(card) {
        if (open[card.id]) {
          setOpen((prev) => ({ ...prev, [card.id]: undefined }))
          return
        }
        setCardError((prev) => ({ ...prev, [card.id]: '' }))
        try {
          const statuses = await rpc('transitions', { id: card.id, orgId })
          setOpen((prev) => ({ ...prev, [card.id]: statuses }))
        } catch (err) {
          setCardError((prev) => ({ ...prev, [card.id]: err.message }))
        }
      }

      async function dropOn(statusId, cardId) {
        const card = cardId ? cardsById.get(cardId) : null
        if (!card || card.statusId === statusId) return
        await move(card, statusId)
      }

      async function move(card, statusId) {
        try {
          await rpc('transition', { id: card.id, status: statusId, orgId })
          setOpen((prev) => ({ ...prev, [card.id]: undefined }))
          setCardError((prev) => ({ ...prev, [card.id]: '' }))
          // 云效搜索索引有延迟，先本地搬卡片，避免看起来没生效
          setColumns((prev) => {
            if (!prev) return prev
            const target = prev.find((col) => col.id === statusId)
            if (!target) return prev
            return prev.map((col) => {
              if (col.id === statusId) {
                if (col.cards.some((item) => item.id === card.id)) return col
                return { ...col, cards: [{ ...card, statusId, status: col.label }, ...col.cards], total: col.total + 1 }
              }
              if (!col.cards.some((item) => item.id === card.id)) return col
              return { ...col, cards: col.cards.filter((item) => item.id !== card.id), total: Math.max(0, col.total - 1) }
            })
          })
          setLoading(true)
          // 等索引追平再对齐服务端，避免立刻拉回旧状态
          await new Promise((resolve) => setTimeout(resolve, 1500))
          const board = await rpc('board', { spaceId, category, q, priority, orgId })
          setColumns(board.columns)
        } catch (err) {
          setCardError((prev) => ({ ...prev, [card.id]: err.message }))
        } finally {
          setLoading(false)
        }
      }

      async function showDetail(card) {
        setDetail({ serial: card.serialNumber, detail: null, error: null })
        try {
          const data = await rpc('detail', { id: card.id, orgId })
          setDetail({ serial: card.serialNumber, detail: data, error: null })
        } catch (err) {
          setDetail({ serial: card.serialNumber, detail: null, error: err })
        }
      }

      async function processIn(card, workspaceId) {
        const kind = card.category === 'Bug' ? '缺陷' : '需求'
        const phaseLabel = PHASE_LABEL[card.category] || PHASE_LABEL.Req
        try {
          ctx.uiWorkspace.startSession(workspaceId, {
            prompt: [
              `处理云效${kind} ${card.serialNumber}：${card.subject}`,
              '',
              `工作项 id：${card.id}`,
              `项目 spaceId：${card.spaceId || spaceId}`,
              '',
              `用本插件的工具读工作项：yunxiao_workitems({ action: "detail", id: "${card.id}" })。`,
              `状态已按开发阶段自动流转：开始开发 → ${phaseLabel.start}，提交并推送后调用 yunxiao_transition({ id: "${card.id}", phase: "pushed" }) 改为 ${phaseLabel.pushed}。`,
              `每完成一处需求改动，用 yunxiao_comment({ id: "${card.id}", content: "改了什么、为什么、怎么验证" }) 把改动写进需求评论留档。`,
              `代码推送到 Codeup 后，再调用 yunxiao_comment 并带上 commits：sha、提交标题、Codeup 提交页 url，提交记录会关联到需求；提交信息里也带上 #${card.serialNumber}。`,
              '不要用 curl 调云效接口，也不要加载 yunxiao-dev 技能，插件工具已经覆盖详情、图片、状态流转、评论留档和提交关联。',
            ].join('\n'),
            whenDraftExists: 'replace',
          })
          setPicker(null)
        } catch (err) {
          setCardError((prev) => ({ ...prev, [card.id]: err.message }))
        }
        try {
          await rpc('transition', { id: card.id, phase: 'start', orgId })
          const board = await rpc('board', { spaceId, category, q, priority, orgId })
          setColumns(board.columns)
        } catch (err) {
          setCardError((prev) => ({ ...prev, [card.id]: `状态未改为${phaseLabel.start}：${err.message}` }))
        }
      }

      async function openSettings() {
        try {
          setSettings(await rpc('settings'))
        } catch (err) {
          setError(err)
        }
      }

      async function saveSettings(form) {
        await rpc('saveSettings', form)
        setSettings(null)
        // 连接参数变了，整块重建：组织 → 项目 → 看板
        setLoading(true)
        setError(null)
        setColumns(null)
        setSpaceId('')
        try {
          const data = await rpc('organizations')
          setOrgs(data)
          const activeOrg = data.organizationId || data.organizations[0]?.id || ''
          const list = await rpc('projects', activeOrg || undefined)
          setProjects(list)
          const next = list[0]?.id || ''
          if (!next) {
            setError(new Error('这个组织下没有可访问的项目'))
            return
          }
          setSpaceId(next)
          const board = await rpc('board', { spaceId: next, category, q, priority, orgId: activeOrg })
          setColumns(board.columns)
          setError(board.columns?.length ? null : new Error('这个项目下没有可访问的工作项'))
        } catch (err) {
          setError(err)
        } finally {
          setLoading(false)
        }
      }

      const note = emptyText(error, columns, q)
      const people = [...new Set((columns || []).flatMap((col) => col.cards.map((card) => card.assignee)).filter(Boolean))]
      const groups = []
      for (const col of columns || []) {
        let group = groups.find((row) => row.category === col.category)
        if (!group) groups.push((group = { category: col.category, columns: [] }))
        group.columns.push(col)
      }

      return h('div', {
        style: {
          height: '100%', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          background: '#f7f5f0', color: '#22201c', padding: '16px 20px',
          font: '14px/1.5 system-ui, -apple-system, "PingFang SC", sans-serif',
        },
      },
        h('style', null, '@keyframes yx-spin{to{transform:rotate(360deg)}}'),
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flex: 'none' } },
          h('h1', { style: { margin: 0, fontSize: 18, fontWeight: 650, letterSpacing: '-.01em' } }, '云效进度'),
          loading ? h('span', { style: { fontSize: 12, color: '#a89c88' } }, '加载中…') : null,
          h('span', { style: { flex: 1 } }),
          error ? h('span', { style: { fontSize: 12, color: '#a3342b' } }, error.message) : null),

        h('div', {
          style: {
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, flex: 'none',
            background: '#fff', border: '1px solid #eae5da', borderRadius: 10, padding: '8px 10px',
          },
        },
          orgs.organizations.length > 0 && orgs.edition !== 'region' ? h('select', {
            value: orgs.organizationId,
            title: orgs.error ? `组织列表读取失败：${orgs.error}` : '切换组织',
            onChange: (event) => chooseOrg(event.target.value),
            style: { ...fieldStyle, maxWidth: 220 },
          }, [
            orgs.organizationId ? null : h('option', { key: '__none', value: '' }, '选择组织'),
            ...orgs.organizations.map((org) => h('option', { key: org.id, value: org.id }, org.name || org.id)),
          ]) : null,
          h('select', { value: spaceId, onChange: (event) => chooseSpace(event.target.value), style: fieldStyle },
            projects.length ? null : h('option', { value: '' }, '尚无项目'),
            projects.map((project) => h('option', { key: project.id, value: project.id }, project.name || project.code || project.id))),
          h('div', { style: { display: 'flex', background: '#f4f1ea', borderRadius: 7, padding: 2 } },
            [['Req', '需求'], ['Bug', '缺陷']].map(([value, label]) => h('button', {
              key: value,
              type: 'button',
              onClick: () => setCategory(value),
              style: {
                cursor: 'pointer', border: 0, borderRadius: 5, padding: '5px 12px', fontSize: 12.5,
                background: category === value ? '#fff' : 'transparent',
                color: category === value ? '#22201c' : '#7c715f',
                boxShadow: category === value ? '0 1px 2px rgba(60,50,30,.12)' : 'none',
              },
            }, label))),
          h('input', {
            value: draft, placeholder: '搜索编号或标题', onChange: (event) => setDraft(event.target.value),
            style: { ...fieldStyle, width: 200 },
          }),
          h('select', { value: priority, onChange: (event) => setPriority(event.target.value), style: fieldStyle },
            h('option', { value: '' }, '全部优先级'),
            PRIORITIES.map((level) => h('option', { key: level.id, value: level.id }, level.label))),
          h('select', { value: assignee, onChange: (event) => setAssignee(event.target.value), style: fieldStyle },
            h('option', { value: '' }, '全部负责人'),
            people.map((name) => h('option', { key: name, value: name }, name))),
          h('button', {
            type: 'button',
            onClick: () => { setQ(draft.trim()); setTick((value) => value + 1) },
            disabled: loading,
            style: {
              ...fieldStyle, color: '#5c5346', background: '#faf8f3',
              cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            },
          },
            loading ? h('span', {
              'aria-hidden': true,
              style: {
                display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                border: '2px solid #c8bfae', borderTopColor: '#5c5346',
                animation: 'yx-spin .7s linear infinite',
              },
            }) : null,
            loading ? '刷新中' : '刷新'),
          h('button', {
            type: 'button', onClick: openSettings,
            style: { ...fieldStyle, cursor: 'pointer', color: '#5c5346' },
          }, '设置')),

        note ? h('div', {
          style: {
            display: 'grid', placeItems: 'center', gap: 6, padding: '56px 0', color: '#8a7f6b',
            background: '#fff', border: '1px dashed #e3ded2', borderRadius: 12,
          },
        }, h(Icon), h('div', { style: { fontSize: 13 } }, note)) : null,

        groups.map((group) => h('div', { key: group.category, style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 0 } },
          groups.length > 1 ? h('div', {
            style: { fontSize: 12, fontWeight: 600, color: '#8a7f6b', marginBottom: 8 },
          }, group.category === 'Bug' ? '缺陷' : '需求') : null,
          h('div', { style: { display: 'flex', gap: 12, overflowX: 'auto', overflowY: 'hidden', alignItems: 'stretch', flex: 1, minHeight: 0, paddingBottom: 16, scrollbarGutter: 'stable' } },
            group.columns.map((col) => {
              const visible = col.cards.filter((card) => !assignee || card.assignee === assignee)
              const color = STATUS_COLORS[col.label] || '#8a7f6b'
              const dropping = dropTarget === col.id && dragging !== null
              return h('section', {
                key: `${col.category}:${col.id}`,
                onDragOver: (event) => {
                  if (!dragging) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  if (dropTarget !== col.id) setDropTarget(col.id)
                },
                onDragLeave: (event) => {
                  if (event.currentTarget.contains(event.relatedTarget)) return
                  setDropTarget((current) => (current === col.id ? null : current))
                },
                onDrop: (event) => {
                  event.preventDefault()
                  const cardId = event.dataTransfer.getData('text/plain') || dragging?.id
                  setDropTarget(null)
                  setDragging(null)
                  dropOn(col.id, cardId)
                },
                style: {
                  // 等宽分配：6 列在一屏内放下，空列不塌缩也不撑爆
                  flex: '1 1 0', minWidth: 0, maxWidth: 'none', background: '#fff',
                  border: `1px solid ${dropping ? color : '#eae5da'}`,
                  borderStyle: dropping ? 'dashed' : 'solid',
                  borderRadius: 10, padding: '10px 10px 12px',
                  display: 'flex', flexDirection: 'column', minHeight: 0,
                  transition: 'border-color .12s ease, box-shadow .12s ease',
                },
              },
                h('header', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flex: 'none' } },
                  h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: color } }),
                  h('span', { style: { fontSize: 13, fontWeight: 600, color: '#3f382e' } }, col.label),
                  h('span', {
                    style: {
                      fontSize: 11, color: '#8a8172', background: '#f4f1ea', borderRadius: 999,
                      padding: '1px 8px', fontVariantNumeric: 'tabular-nums',
                    },
                  }, col.total)),
                h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', marginRight: -6, paddingRight: 6 } },
                  visible.length
                  ? visible.map((card) => h(Card, {
                    key: card.id,
                    card: { ...card, statusColor: color },
                    statuses: open[card.id],
                    error: cardError[card.id],
                    workspaces,
                    canProcess: OPEN_STATUSES.has(col.label),
                    pickerOpen: picker === card.id,
                    dragging: dragging?.id === card.id,
                    onDragStart: setDragging,
                    onDragEnd: () => { setDragging(null); setDropTarget(null) },
                    onLoadStatuses: showStatuses,
                    onToggleWorkspaces: (target) => setPicker((current) => (current === target.id ? null : target.id)),
                    onProcess: processIn,
                    onMove: move,
                    onOpen: showDetail,
                  }))
                  : h('div', { style: { fontSize: 12, color: '#b3a893', padding: '18px 0', textAlign: 'center' } }, '暂无')),
              )
            })))),
        settings ? h(Settings, { initial: settings, orgs, onSave: saveSettings, onClose: () => setSettings(null) }) : null,
        detail ? h(Detail, {
          serial: detail.serial,
          detail: detail.detail,
          error: detail.error,
          onClose: () => setDetail(null),
        }) : null)
    }

    const fieldStyle = {
      border: '1px solid #e6e2d9', background: '#fff', borderRadius: 7,
      padding: '5px 9px', fontSize: 12.5, color: '#3f382e', outline: 'none',
    }

    return {
      inject: ['slots', 'workspaces', 'uiWorkspace'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'yunxiao', label: '云效', order: 40,
        }, Icon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'yunxiao', inject: () => ({ ctx }),
        }, Board))
      },
    }
  },
})
