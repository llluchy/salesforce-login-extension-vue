// ============================================
// Passkey 浮层 UI 组件
// 在页面上显示浮层，供用户选择环境或创建新环境
// 替代 Side Panel 的 Passkey 选择流程
// 主题：与插件保持一致（浅蓝色主题）
// ============================================

const PasskeyUI = {
  _overlay: null,
  _resolve: null,

  // 主题常量（浅蓝色主题）
  _THEME: {
    bgDark: '#1976d2',           // 主蓝色
    bgDarkAlt: '#e3f2fd',        // 浅蓝
    borderDark: '#bbdefb',       // 边界浅蓝
    textLight: '#ffffff',
    textMuted: 'rgba(255,255,255,0.85)',
    bgContent: '#ffffff',
    bgHover: '#f5f9ff',
    borderLight: '#bbdefb',
    textDark: '#0d47a1',         // 深蓝文字
    textSecondary: '#1976d2',    // 副文字
    accent: '#1976d2',           // 主蓝
    accentDark: '#0d47a1',       // 深蓝
    danger: '#f44336',
    success: '#4caf50',
    gradientHeader: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)'
  },

  // 创建品牌头部（带 logo + 标题）
  _createHeader(titleText, subtitleText) {
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 16px 20px;
      background: ${this._THEME.gradientHeader};
      color: ${this._THEME.textLight};
      border-bottom: 1px solid ${this._THEME.borderDark};
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 2px 6px rgba(25, 118, 210, 0.25);
    `;

    // Logo 图标（云朵 + 钥匙组合，使用 SVG）
    const logo = document.createElement('div');
    logo.style.cssText = `
      width: 32px;
      height: 32px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: 1px solid rgba(255, 255, 255, 0.3);
    `;
    logo.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="${this._THEME.textLight}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 8a4 4 0 017.5-2H14a3 3 0 010 6h-1"/>
        <circle cx="8" cy="14" r="2"/>
        <path d="M10 14h6"/>
        <path d="M14 14v2"/>
      </svg>
    `;
    header.appendChild(logo);

    // 标题区
    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'flex: 1; min-width: 0;';

    const brand = document.createElement('div');
    brand.style.cssText = 'font-size: 11px; color: ' + this._THEME.textMuted + '; letter-spacing: 0.3px; margin-bottom: 2px;';
    brand.textContent = 'SALESFORCE QUICK LOGIN';
    titleWrap.appendChild(brand);

    const title = document.createElement('div');
    title.style.cssText = 'font-size: 15px; font-weight: 600; color: ' + this._THEME.textLight + ';';
    title.textContent = titleText;
    titleWrap.appendChild(title);

    if (subtitleText) {
      const subtitle = document.createElement('div');
      subtitle.style.cssText = 'font-size: 12px; color: ' + this._THEME.textMuted + '; margin-top: 2px;';
      subtitle.textContent = subtitleText;
      titleWrap.appendChild(subtitle);
    }

    header.appendChild(titleWrap);
    return header;
  },

  // 创建底部按钮栏
  _createFooter() {
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding: 12px 20px;
      background: ${this._THEME.bgHover};
      border-top: 1px solid ${this._THEME.borderDark};
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 10px;
    `;
    return footer;
  },

  // 创建按钮（浅蓝色主题风格）
  _createButton(text, variant) {
    const btn = document.createElement('button');
    btn.textContent = text;
    const base = `
      border: none;
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
      padding: 8px 18px;
      font-family: inherit;
      transition: all 0.15s;
    `;
    if (variant === 'primary') {
      btn.style.cssText = base + `
        background: ${this._THEME.accent};
        color: ${this._THEME.textLight};
        font-weight: 600;
      `;
      btn.onmouseenter = () => { btn.style.background = this._THEME.accentDark; };
      btn.onmouseleave = () => { btn.style.background = this._THEME.accent; };
    } else if (variant === 'link') {
      btn.style.cssText = base + `
        background: transparent;
        color: ${this._THEME.accent};
        padding: 8px 12px;
      `;
      btn.onmouseenter = () => { btn.style.textDecoration = 'underline'; };
      btn.onmouseleave = () => { btn.style.textDecoration = 'none'; };
    } else {
      // secondary
      btn.style.cssText = base + `
        background: ${this._THEME.bgDarkAlt};
        color: ${this._THEME.textDark};
        border: 1px solid ${this._THEME.borderDark};
      `;
      btn.onmouseenter = () => { btn.style.background = '#bbdefb'; };
      btn.onmouseleave = () => { btn.style.background = this._THEME.bgDarkAlt; };
    }
    return btn;
  },

  // 创建容器（遮罩 + 卡片）
  _createContainer() {
    const overlay = document.createElement('div');
    overlay.id = 'sf-passkey-ui-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      background: ${this._THEME.bgContent};
      border-radius: 8px;
      box-shadow: 0 20px 60px rgba(25, 118, 210, 0.35);
      width: 420px;
      max-width: 90vw;
      max-height: 80vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      border: 1px solid #bbdefb;
    `;

    overlay.appendChild(card);
    // 注意：不绑定 overlay.onclick，避免误操作关闭
    // 用户只能通过底部按钮主动关闭

    return { overlay, card };
  },

  // 显示选择环境的浮层
  showSelector(mode, environments, rpId, options) {
    console.log('[UI] ⓪ showSelector 入参', {
      mode,
      rpId,
      envCount: (environments || []).length,
      envs: (environments || []).map(e => ({
        id: e.id,
        passkeysType: typeof e.passkeys,
        passkeysIsArray: Array.isArray(e.passkeys),
        passkeysLength: Array.isArray(e.passkeys) ? e.passkeys.length : 0
      }))
    });
    this.close();

    options = options || {};

    return new Promise((resolve) => {
      try {
        this._resolve = resolve;

        const { overlay, card } = this._createContainer();

        // 头部
        const header = this._createHeader(
          mode === 'create' ? '创建 Passkey' : '选择 Passkey 验证',
          mode === 'create' ? '请选择要绑定的环境' : '请选择用于验证的环境'
        );
        card.appendChild(header);

        // 内容区
        const content = document.createElement('div');
        content.style.cssText = 'padding: 14px 20px; overflow-y: auto; flex: 1;';

        // 不做任何筛选，直接使用传入的环境
        let displayEnvs = environments || [];

        console.log('[UI] ⓪ 直接使用传入环境，不做筛选，数量:', displayEnvs.length);

      if (displayEnvs.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align: center; padding: 32px 0; color: ' + this._THEME.textSecondary + '; font-size: 13px;';
        empty.textContent = mode === 'create'
          ? '暂无环境，请创建新环境'
          : '未找到匹配的 Passkey 环境';
        content.appendChild(empty);
      } else {
        displayEnvs.forEach(env => {
          const hasPasskey = env.passkeys && env.passkeys.length > 0;
          const isWarning = mode === 'create' && hasPasskey;

          const item = document.createElement('div');
          const borderColor = isWarning ? '#ff9800' : this._THEME.accent;
          item.style.cssText = `
            padding: 12px 14px;
            border: 1px solid ${this._THEME.borderLight};
            border-left: 3px solid ${borderColor};
            border-radius: 6px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.15s;
            ${isWarning ? 'background: #fff8e1;' : ''}
          `;
          item.onmouseenter = () => {
            item.style.borderColor = borderColor;
            item.style.background = isWarning ? '#ffecb3' : '#f5f9ff';
          };
          item.onmouseleave = () => {
            item.style.borderColor = this._THEME.borderLight;
            item.style.borderLeftColor = borderColor;
            item.style.background = isWarning ? '#fff8e1' : this._THEME.bgContent;
          };

          // 第一行：别名 + 标签
          const row1 = document.createElement('div');
          row1.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';

          const alias = document.createElement('div');
          alias.style.cssText = 'font-weight: 600; color: ' + this._THEME.textDark + '; font-size: 14px;';
          alias.textContent = env.alias || '(未命名)';
          row1.appendChild(alias);

          if (isWarning) {
            const warningTag = document.createElement('span');
            warningTag.style.cssText = `
              display: inline-block;
              font-size: 10px;
              padding: 2px 8px;
              border-radius: 10px;
              background: #ff9800;
              color: white;
              font-weight: 600;
            `;
            warningTag.textContent = '已绑定 Passkey';
            row1.appendChild(warningTag);
          }

          item.appendChild(row1);

          const username = document.createElement('div');
          username.style.cssText = 'font-size: 12px; color: ' + this._THEME.textSecondary + '; margin-top: 4px;';
          username.textContent = env.username || '';
          item.appendChild(username);

          // 标签行
          const tagRow = document.createElement('div');
          tagRow.style.cssText = 'display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap;';

          const typeLabel = document.createElement('span');
          typeLabel.style.cssText = `
            display: inline-block;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 10px;
            background: ${this._THEME.bgHover};
            color: ${this._THEME.textSecondary};
          `;
          typeLabel.textContent = env.type === 'production' ? '生产' : env.type === 'sandbox' ? '沙箱' : '自定义';
          tagRow.appendChild(typeLabel);

          if (isWarning) {
            const warnText = document.createElement('span');
            warnText.style.cssText = `
              display: inline-block;
              font-size: 11px;
              padding: 2px 8px;
              border-radius: 10px;
              background: #ffebee;
              color: #c62828;
            `;
            warnText.textContent = '选择将覆盖原有 Passkey';
            tagRow.appendChild(warnText);
          }

          item.appendChild(tagRow);

          // 默认点击行为
          item.onclick = () => {
            if (isWarning) {
              const confirmed = confirm('该环境已绑定 Passkey，继续操作将覆盖原有绑定。是否继续？');
              if (!confirmed) return;
            }
            this._resolveEnv(env);
          };

          content.appendChild(item);
        });
      }

      card.appendChild(content);

      // 底部按钮
      const footer = this._createFooter();

      if (mode === 'create') {
        const createBtn = this._createButton('创建新环境', 'link');
        createBtn.onclick = () => {
          this.close();
          this.showCreateEnv(rpId).then(newEnv => {
            if (newEnv) {
              resolve(newEnv);
            } else {
              // 用户取消了创建，重新显示选择器
              this.showSelector(mode, environments, rpId).then(resolve);
            }
          });
        };
        footer.appendChild(createBtn);
      }

      const cancelBtn = this._createButton('取消', 'secondary');
      cancelBtn.onclick = () => {
        this._resolveEnv(null);
      };
      footer.appendChild(cancelBtn);

      card.appendChild(footer);
      document.body.appendChild(overlay);
      this._overlay = overlay;
      console.log('[UI] ⓪ 浮层已挂载到 DOM，等待用户选择');
    } catch (e) {
      console.error('[UI] ⓪ showSelector 异常', e);
      resolve(null);
    }
    });
  },

  // 显示创建新环境的浮层
  showCreateEnv(rpId) {
    this.close();

    return new Promise((resolve) => {
      this._resolve = resolve;

      const { overlay, card } = this._createContainer();

      // 头部
      const header = this._createHeader('创建新环境', '将创建环境并绑定 Passkey');
      card.appendChild(header);

      // 表单
      const form = document.createElement('div');
      form.style.cssText = 'padding: 14px 20px; overflow-y: auto; flex: 1;';

      const fields = [
        { key: 'alias', label: '别名', type: 'text', required: true, placeholder: '我的环境' },
        { key: 'username', label: '账号', type: 'text', required: true, placeholder: 'user@example.com' },
        { key: 'password', label: '密码', type: 'password', required: true, placeholder: '••••••••' },
      ];

      const inputs = {};
      fields.forEach(field => {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin-bottom: 12px;';

        const label = document.createElement('label');
        label.style.cssText = 'display: block; font-size: 12px; color: ' + this._THEME.textDark + '; margin-bottom: 5px; font-weight: 500;';
        label.textContent = field.label + (field.required ? ' *' : '');
        wrapper.appendChild(label);

        const input = document.createElement('input');
        input.type = field.type;
        input.placeholder = field.placeholder;
        input.style.cssText = `
          width: 100%;
          padding: 9px 11px;
          border: 1px solid ${this._THEME.borderLight};
          border-radius: 4px;
          font-size: 13px;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.15s;
          font-family: inherit;
        `;
        input.onfocus = () => {
          input.style.borderColor = this._THEME.accent;
          input.style.boxShadow = '0 0 0 2px rgba(25, 118, 210, 0.1)';
        };
        input.onblur = () => {
          input.style.borderColor = this._THEME.borderLight;
          input.style.boxShadow = 'none';
        };
        wrapper.appendChild(input);
        inputs[field.key] = input;
        form.appendChild(wrapper);
      });

      // 类型选择
      const typeWrapper = document.createElement('div');
      typeWrapper.style.cssText = 'margin-bottom: 12px;';
      const typeLabel = document.createElement('label');
      typeLabel.style.cssText = 'display: block; font-size: 12px; color: ' + this._THEME.textDark + '; margin-bottom: 5px; font-weight: 500;';
      typeLabel.textContent = '类型';
      typeWrapper.appendChild(typeLabel);

      const typeSelect = document.createElement('select');
      typeSelect.style.cssText = `
        width: 100%;
        padding: 9px 11px;
        border: 1px solid ${this._THEME.borderLight};
        border-radius: 4px;
        font-size: 13px;
        box-sizing: border-box;
        outline: none;
        background: white;
        font-family: inherit;
        transition: all 0.15s;
      `;
      typeSelect.onfocus = () => {
        typeSelect.style.borderColor = this._THEME.accent;
        typeSelect.style.boxShadow = '0 0 0 2px rgba(25, 118, 210, 0.1)';
      };
      typeSelect.onblur = () => {
        typeSelect.style.borderColor = this._THEME.borderLight;
        typeSelect.style.boxShadow = 'none';
      };
      ['production', 'sandbox', 'custom'].forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t === 'production' ? '生产' : t === 'sandbox' ? '沙箱' : '自定义';
        typeSelect.appendChild(opt);
      });
      typeWrapper.appendChild(typeSelect);
      form.appendChild(typeWrapper);
      card.appendChild(form);

      // 底部按钮
      const footer = this._createFooter();

      const cancelBtn = this._createButton('取消', 'secondary');
      cancelBtn.onclick = () => { this._resolveEnv(null); };
      footer.appendChild(cancelBtn);

      const saveBtn = this._createButton('保存并绑定', 'primary');
      saveBtn.onclick = () => {
        const alias = inputs.alias.value.trim();
        const username = inputs.username.value.trim();
        const password = inputs.password.value;

        if (!alias || !username || !password) {
          this._showError(form, '请填写必填字段');
          return;
        }

        const now = Date.now();
        const newEnv = {
          id: Date.now().toString(),
          alias: alias,
          username: username,
          password: password,
          type: typeSelect.value,
          customUrl: '',
          groupId: 'ungrouped',
          totpSecret: '',
          passkeys: [],
          createdAt: now,
          updatedAt: now
        };

        this._resolveEnv(newEnv);
      };
      footer.appendChild(saveBtn);
      card.appendChild(footer);

      document.body.appendChild(overlay);
      this._overlay = overlay;

      // 自动聚焦第一个输入框
      setTimeout(() => inputs.alias.focus(), 100);
    });
  },

  // 显示错误提示
  _showError(container, message) {
    const existing = container.querySelector('.sf-error');
    if (existing) existing.remove();

    const error = document.createElement('div');
    error.className = 'sf-error';
    error.style.cssText = `
      color: ${this._THEME.danger};
      font-size: 12px;
      margin-top: 8px;
      padding: 8px 12px;
      background: #ffebee;
      border-left: 3px solid ${this._THEME.danger};
      border-radius: 4px;
    `;
    error.textContent = message;
    container.appendChild(error);

    setTimeout(() => error.remove(), 3000);
  },

  // rpId 匹配逻辑
  _rpIdMatches(pkRpId, targetRpId) {
    if (!pkRpId || !targetRpId) return false;
    if (pkRpId === targetRpId) return true;
    if (targetRpId.endsWith('.' + pkRpId)) return true;
    if (pkRpId.endsWith('.' + targetRpId)) return true;
    return false;
  },

  // 解析选择结果
  _resolveEnv(env) {
    if (this._resolve) {
      this._resolve(env);
      this._resolve = null;
    }
    this.close();
  },

  // 关闭浮层
  close() {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
  }
};
