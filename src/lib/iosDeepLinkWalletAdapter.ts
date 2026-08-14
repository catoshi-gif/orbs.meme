"use client";

import {
  BaseMessageSignerWalletAdapter,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletNotConnectedError,
  WalletReadyState,
  WalletSignMessageError,
  WalletSignTransactionError,
  type TransactionOrVersionedTransaction,
  type WalletName,
} from "@solana/wallet-adapter-base";
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  type TransactionVersion,
} from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

type WalletKind = "phantom" | "solflare";

type PersistedSession = {
  dappPublicKey: string;
  dappSecretKey: string;
  walletEncryptionPublicKey: string;
  publicKey: string;
  session: string;
};

type CallbackPayload = Record<string, string>;

const STORAGE_PREFIX = "orbs:ios-wallet:v1:";
const CALLBACK_PREFIX = "orbs:ios-wallet:callback:";
const CALLBACK_CHANNEL_PREFIX = "orbs:ios-wallet:callback:";
const CALLBACK_TIMEOUT_MS = 180_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function storageKey(kind: WalletKind) {
  return `${STORAGE_PREFIX}${kind}`;
}

function readSession(kind: WalletKind): PersistedSession | null {
  try {
    const raw = localStorage.getItem(storageKey(kind));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedSession>;
    if (
      typeof value.dappPublicKey !== "string" ||
      typeof value.dappSecretKey !== "string" ||
      typeof value.walletEncryptionPublicKey !== "string" ||
      typeof value.publicKey !== "string" ||
      typeof value.session !== "string"
    ) {
      return null;
    }
    return value as PersistedSession;
  } catch {
    return null;
  }
}

function writeSession(kind: WalletKind, session: PersistedSession) {
  localStorage.setItem(storageKey(kind), JSON.stringify(session));
}

function clearSession(kind: WalletKind) {
  try {
    localStorage.removeItem(storageKey(kind));
  } catch {
    // Cosmetic persistence failure must never block disconnect.
  }
}

function randomOperationId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function walletBase(kind: WalletKind, method: string) {
  return kind === "phantom"
    ? `https://phantom.app/ul/v1/${method}`
    : `https://solflare.com/ul/v1/${method}`;
}

function callbackUrl(kind: WalletKind, operationId: string) {
  const url = new URL("/wallet/ios-callback", window.location.origin);
  url.searchParams.set("wallet", kind);
  url.searchParams.set("op", operationId);
  return url.toString();
}

function callbackStorageKey(operationId: string) {
  return `${CALLBACK_PREFIX}${operationId}`;
}

function consumeStoredCallback(operationId: string): CallbackPayload | null {
  try {
    const key = callbackStorageKey(operationId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    localStorage.removeItem(key);
    return JSON.parse(raw) as CallbackPayload;
  } catch {
    return null;
  }
}

/**
 * Opens the wallet universal link in a separate browser context. On iOS the
 * universal link hands that tab to the wallet app; the wallet's HTTPS redirect
 * returns to /wallet/ios-callback, which broadcasts the result back to the
 * original Orbs Safari tab. The original page, X cookie, React state and pending
 * wallet-adapter promise stay alive.
 */
async function openWalletAndWait(kind: WalletKind, url: string, operationId: string) {
  return new Promise<CallbackPayload>((resolve, reject) => {
    const channelName = `${CALLBACK_CHANNEL_PREFIX}${operationId}`;
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(channelName) : null;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      channel?.close();
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };

    const finish = (payload: CallbackPayload) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (payload.errorCode || payload.errorMessage) {
        reject(new Error(payload.errorMessage || `Wallet request rejected (${payload.errorCode || "unknown"})`));
      } else {
        resolve(payload);
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== callbackStorageKey(operationId) || !event.newValue) return;
      try {
        localStorage.removeItem(callbackStorageKey(operationId));
        finish(JSON.parse(event.newValue) as CallbackPayload);
      } catch {
        // Ignore malformed cross-tab data.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const payload = consumeStoredCallback(operationId);
      if (payload) finish(payload);
    };

    channel?.addEventListener("message", (event: MessageEvent<CallbackPayload>) => {
      if (event.data && typeof event.data === "object") finish(event.data);
    });
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);

    timer = setTimeout(() => {
      cleanup();
      reject(new Error("Wallet approval timed out. Return to Safari and try again."));
    }, CALLBACK_TIMEOUT_MS);

    // target=_blank is intentional. It keeps the original Orbs Safari tab alive
    // while iOS hands the newly opened universal-link context to the wallet app.
    const launched = window.open("about:blank", "_blank");
    if (!launched) {
      cleanup();
      reject(new Error("Safari blocked the wallet window. Allow pop-ups for Orbs and try again."));
      return;
    }
    // Detach the new tab from the opener before sending it cross-origin. The
    // callback communicates only through BroadcastChannel/localStorage.
    try { launched.opener = null; } catch {}
    launched.location.href = url;
  });
}

function sharedSecret(session: PersistedSession) {
  return nacl.box.before(
    bs58.decode(session.walletEncryptionPublicKey),
    bs58.decode(session.dappSecretKey),
  );
}

function encryptPayload(session: PersistedSession, payload: object) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box.after(
    encoder.encode(JSON.stringify(payload)),
    nonce,
    sharedSecret(session),
  );
  return {
    nonce: bs58.encode(nonce),
    payload: bs58.encode(encrypted),
  };
}

function decryptData(session: PersistedSession, nonceValue: string, dataValue: string) {
  const opened = nacl.box.open.after(
    bs58.decode(dataValue),
    bs58.decode(nonceValue),
    sharedSecret(session),
  );
  if (!opened) throw new Error("Wallet response could not be decrypted");
  return JSON.parse(decoder.decode(opened)) as Record<string, string>;
}

function deserializeSignedTransaction<T extends Transaction | VersionedTransaction>(
  original: T,
  encoded: string,
): T {
  const bytes = bs58.decode(encoded);
  if (original instanceof VersionedTransaction) {
    return VersionedTransaction.deserialize(bytes) as T;
  }
  return Transaction.from(bytes) as T;
}

function serializeTransaction(transaction: Transaction | VersionedTransaction) {
  if (transaction instanceof VersionedTransaction) {
    return bs58.encode(transaction.serialize());
  }
  return bs58.encode(
    transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  );
}

export class IosSafariDeepLinkWalletAdapter extends BaseMessageSignerWalletAdapter {
  readonly supportedTransactionVersions: ReadonlySet<TransactionVersion> | null = new Set(["legacy", 0]);
  readonly name: WalletName;
  readonly url: string;
  readonly icon: string;
  readonly readyState = WalletReadyState.Loadable;

  private readonly kind: WalletKind;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;

  constructor(config: { kind: WalletKind; name: string; url: string; icon: string }) {
    super();
    this.kind = config.kind;
    this.name = config.name as WalletName;
    this.url = config.url;
    this.icon = config.icon;
  }

  get publicKey() {
    return this._publicKey;
  }

  get connecting() {
    return this._connecting;
  }

  async connect() {
    try {
      if (this.connected || this._connecting) return;
      this._connecting = true;

      const stored = readSession(this.kind);
      if (stored) {
        this._publicKey = new PublicKey(stored.publicKey);
        this.emit("connect", this._publicKey);
        return;
      }

      const dappKeyPair = nacl.box.keyPair();
      const operationId = randomOperationId();
      const redirect = callbackUrl(this.kind, operationId);
      const url = new URL(walletBase(this.kind, "connect"));
      url.searchParams.set("app_url", window.location.origin);
      url.searchParams.set("dapp_encryption_public_key", bs58.encode(dappKeyPair.publicKey));
      url.searchParams.set("redirect_link", redirect);
      url.searchParams.set("cluster", "mainnet-beta");

      const response = await openWalletAndWait(this.kind, url.toString(), operationId);
      const walletEncryptionPublicKey =
        response.phantom_encryption_public_key || response.solflare_encryption_public_key;
      if (!walletEncryptionPublicKey || !response.nonce || !response.data) {
        throw new Error("Wallet returned an incomplete connection response");
      }

      const provisional: PersistedSession = {
        dappPublicKey: bs58.encode(dappKeyPair.publicKey),
        dappSecretKey: bs58.encode(dappKeyPair.secretKey),
        walletEncryptionPublicKey,
        publicKey: "",
        session: "",
      };

      const opened = decryptData(provisional, response.nonce, response.data);
      if (!opened.public_key || !opened.session) {
        throw new Error("Wallet returned an invalid connection session");
      }

      const saved: PersistedSession = {
        ...provisional,
        publicKey: opened.public_key,
        session: opened.session,
      };
      writeSession(this.kind, saved);

      this._publicKey = new PublicKey(saved.publicKey);
      this.emit("connect", this._publicKey);
    } catch (error) {
      const wrapped = error instanceof WalletConnectionError
        ? error
        : new WalletConnectionError(error instanceof Error ? error.message : "Wallet connection failed", error);
      this.emit("error", wrapped);
      throw wrapped;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect() {
    try {
      clearSession(this.kind);
      this._publicKey = null;
      this.emit("disconnect");
    } catch (error) {
      const wrapped = new WalletDisconnectionError(
        error instanceof Error ? error.message : "Wallet disconnect failed",
        error,
      );
      this.emit("error", wrapped);
      throw wrapped;
    }
  }

  async signTransaction<
    T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>
  >(transaction: T): Promise<T> {
    try {
      const session = readSession(this.kind);
      if (!session || !this._publicKey) throw new WalletNotConnectedError();

      const { nonce, payload } = encryptPayload(session, {
        transaction: serializeTransaction(transaction),
        session: session.session,
      });
      const operationId = randomOperationId();
      const url = new URL(walletBase(this.kind, "signTransaction"));
      url.searchParams.set("dapp_encryption_public_key", session.dappPublicKey);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("redirect_link", callbackUrl(this.kind, operationId));
      url.searchParams.set("payload", payload);

      const response = await openWalletAndWait(this.kind, url.toString(), operationId);
      if (!response.nonce || !response.data) throw new Error("Wallet returned an incomplete signature response");
      const opened = decryptData(session, response.nonce, response.data);
      if (!opened.transaction) throw new Error("Wallet did not return a signed transaction");
      return deserializeSignedTransaction(transaction as Transaction | VersionedTransaction, opened.transaction) as T;
    } catch (error) {
      if (error instanceof WalletNotConnectedError) throw error;
      const wrapped = new WalletSignTransactionError(
        error instanceof Error ? error.message : "Transaction signing failed",
        error,
      );
      this.emit("error", wrapped);
      throw wrapped;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      const session = readSession(this.kind);
      if (!session || !this._publicKey) throw new WalletNotConnectedError();

      const { nonce, payload } = encryptPayload(session, {
        message: bs58.encode(message),
        session: session.session,
        display: "utf8",
      });
      const operationId = randomOperationId();
      const url = new URL(walletBase(this.kind, "signMessage"));
      url.searchParams.set("dapp_encryption_public_key", session.dappPublicKey);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("redirect_link", callbackUrl(this.kind, operationId));
      url.searchParams.set("payload", payload);

      const response = await openWalletAndWait(this.kind, url.toString(), operationId);
      if (!response.nonce || !response.data) throw new Error("Wallet returned an incomplete message response");
      const opened = decryptData(session, response.nonce, response.data);
      if (!opened.signature) throw new Error("Wallet did not return a message signature");
      return bs58.decode(opened.signature);
    } catch (error) {
      if (error instanceof WalletNotConnectedError) throw error;
      const wrapped = new WalletSignMessageError(
        error instanceof Error ? error.message : "Message signing failed",
        error,
      );
      this.emit("error", wrapped);
      throw wrapped;
    }
  }
}
