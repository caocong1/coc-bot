/**
 * NapCat 传输层
 *
 * 负责与 NapCatQQ 的 WebSocket 连接、心跳、断线重连和事件分发
 */

type EventCallback = (data: unknown) => void;

export interface NapCatTransportOptions {
  wsUrl: string;
  token?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class NapCatTransport {
  private ws?: WebSocket;
  private options: Required<NapCatTransportOptions>;
  private listeners: Map<string, EventCallback[]> = new Map();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private intentionalClose = false;

  constructor(opts: NapCatTransportOptions) {
    this.options = {
      reconnectInterval: opts.reconnectInterval ?? 5000,
      maxReconnectAttempts: opts.maxReconnectAttempts ?? 0, // 0 = unlimited
      wsUrl: opts.wsUrl,
      token: opts.token ?? '',
    };
  }

  /* ───────── lifecycle ───────── */

  async connect(): Promise<void> {
    this.intentionalClose = false;
    return this.doConnect();
  }

  disconnect(): void {
    this.intentionalClose = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    console.log('[NapCat] disconnected');
  }

  /* ───────── events ───────── */

  on(event: string, cb: EventCallback): void {
    const cbs = this.listeners.get(event) ?? [];
    cbs.push(cb);
    this.listeners.set(event, cbs);
  }

  private emit(event: string, data: unknown): void {
    const cbs = this.listeners.get(event) ?? [];
    for (const cb of cbs) {
      try { cb(data); } catch (e) { console.error('[NapCat] listener error', e); }
    }
  }

  /* ───────── send ───────── */

  send(data: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify(data));
  }

  /* ───────── internal ───────── */

  private doConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // 如果配置了 token，附加到 URL 查询参数中（NapCat 正向 WS 鉴权方式）
      let url = this.options.wsUrl;
      if (this.options.token) {
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}access_token=${this.options.token}`;
      }
      console.log(`[NapCat] connecting to ${this.options.wsUrl} …`);
      const ws = new WebSocket(url);

      ws.addEventListener('open', () => {
        console.log('[NapCat] connected');
        this.ws = ws;
        this.reconnectAttempts = 0;
        this.emit('open', null);
        resolve();
      });

      ws.addEventListener('message', (ev) => {
        try {
          const data = JSON.parse(String(ev.data));
          this.handleRaw(data);
        } catch (e) {
          console.error('[NapCat] bad JSON', e);
        }
      });

      ws.addEventListener('close', (ev) => {
        console.log(`[NapCat] closed (code=${ev.code})`);
        this.ws = undefined;
        this.emit('close', ev);
        if (!this.intentionalClose) this.scheduleReconnect();
      });

      ws.addEventListener('error', (ev) => {
        console.error('[NapCat] ws error', ev);
        this.emit('error', ev);
        reject(ev);
      });
    });
  }

  private handleRaw(data: Record<string, unknown>): void {
    const postType = data.post_type as string | undefined;
    const metaEventType = data.meta_event_type as string | undefined;

    // 心跳事件不需要转发给业务层
    if (postType === 'meta_event' && metaEventType === 'heartbeat') {
      return;
    }

    // 调试：输出收到的事件类型
    console.log(`[NapCat] event: post_type=${postType} meta_event_type=${metaEventType ?? ''} message_type=${data.message_type ?? ''}`);


    // lifecycle 事件记录
    if (postType === 'meta_event' && metaEventType === 'lifecycle') {
      console.log('[NapCat] lifecycle:', data.sub_type);
      this.emit('lifecycle', data);
      return;
    }

    // 消息事件
    if (postType === 'message' || postType === 'message_sent') {
      this.emit('message', data);
      return;
    }

    // 通知事件
    if (postType === 'notice') {
      this.emit('notice', data);
      return;
    }

    // 请求事件
    if (postType === 'request') {
      this.emit('request', data);
      return;
    }

    // 其余
    this.emit('raw', data);
  }

  private scheduleReconnect(): void {
    const max = this.options.maxReconnectAttempts;
    if (max > 0 && this.reconnectAttempts >= max) {
      console.error('[NapCat] max reconnect attempts reached');
      return;
    }
    this.reconnectAttempts++;
    const delay = this.options.reconnectInterval;
    console.log(`[NapCat] reconnect #${this.reconnectAttempts} in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.doConnect().catch(() => {/* scheduleReconnect will be called by close */});
    }, delay);
  }
}
