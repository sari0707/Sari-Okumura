import React, { useState, useEffect, useCallback } from "react";
import {
  Leaf, Lock, Mail, Phone, MapPin, Instagram, Link as LinkIcon,
  ShoppingCart, Package, ClipboardList, User, Home, Plus, Minus,
  Trash2, CheckCircle2, Circle, Clock, Truck, Building2, Settings,
  ChevronLeft, ChevronRight, Search, X, AlertCircle, LogOut,
  ShieldCheck, Banknote, Edit3, Eye, EyeOff, ArrowRight, Sparkles
} from "lucide-react";
import { supabase } from "./src/supabaseClient.js";

const SALON_SHARED_PASSWORD = import.meta.env.VITE_SALON_SHARED_PASSWORD || "";
const PARTNER_SHARED_PASSWORD = import.meta.env.VITE_PARTNER_SHARED_PASSWORD || "";

/* ============================================================
   BRAND TOKENS
   forest: #2D4A35 / forest-deep:#1F3527 / gold:#C9A84C
   ivory:#F4F1E8 / sage:#E7ECE4 / clay(alert):#A3543A
============================================================ */
const C = {
  forest: "#2D4A35",
  forestDeep: "#1B2E22",
  forestSoft: "#4A6B52",
  gold: "#C9A84C",
  goldSoft: "#DFC98A",
  ivory: "#F4F1E8",
  sage: "#E7ECE4",
  white: "#FFFFFF",
  ink: "#22301F",
  inkSoft: "#5B6B58",
  clay: "#A3543A",
  claySoft: "#F3E3DB",
  line: "#D8D2C0",
};

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600;700&family=Noto+Sans+JP:wght@300;400;500;600;700&display=swap');`;

const yen = (n) => "¥" + Math.round(n).toLocaleString("ja-JP");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};
const genOrderNumber = () => {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `YW-${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
};

const STATUS_FLOW = ["注文受付", "入金待ち", "入金確認済", "発送準備中", "発送済"];
const STATUS_META = {
  "注文受付": { color: C.inkSoft, icon: Clock },
  "入金待ち": { color: C.clay, icon: AlertCircle },
  "入金確認済": { color: C.forestSoft, icon: CheckCircle2 },
  "発送準備中": { color: C.gold, icon: Package },
  "発送済": { color: C.forest, icon: Truck },
  "キャンセル": { color: C.clay, icon: X },
};

const deriveOrderStatus = (o) => {
  if (o.cancelled) return "キャンセル";
  if (o.shipStatus === "発送済") return "発送済";
  if (o.shipStatus === "発送準備中") return "発送準備中";
  if (o.paymentStatus === "入金確認済") return "入金確認済";
  if (o.paymentStatus === "未入金" && o.paymentRequested) return "入金待ち";
  return "注文受付";
};

const DEFAULT_BANK = {
  bankName: "みずほ銀行",
  branchName: "大阪支店",
  accountType: "普通",
  accountNumber: "1234567",
  accountHolder: "ヨモギノワ サリ",
  deadlineDays: 7,
  issuerName: "",
  issuerAddress: "",
};

/* ------------------------------------------------------------
   Supabase row <-> UI model mapping (DB columns are snake_case;
   the screens below all read/write the original camelCase shape)
------------------------------------------------------------ */
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

const mapSalon = (r) => ({
  id: r.id,
  userId: r.user_id,
  salonName: r.salon_name,
  contactName: r.contact_name,
  email: r.email,
  phone: r.phone,
  zip: r.zip || "",
  address: r.address,
  instagram: r.instagram || "",
  salonUrl: r.salon_url || "",
  desiredProducts: r.desired_products || "",
  notes: r.notes || "",
  status: r.status,
  partnerAccount: r.account_type === "partner",
  registeredAt: fmtDate(r.registered_at),
});
const mapSalons = (rows) => (rows || []).map(mapSalon);

const mapProduct = (r) => ({
  id: r.id,
  name: r.name,
  volume: r.volume || "",
  description: r.description || "",
  generalPrice: Number(r.general_price),
  wholesalePrice: Number(r.wholesale_price),
  partnerPrice: r.partner_price == null ? null : Number(r.partner_price),
  minOrderQty: r.min_order_qty,
  stock: r.stock,
  active: r.active,
  sortOrder: r.sort_order,
  imageUrl: r.image_url || "",
});
const mapProducts = (rows) => (rows || []).map(mapProduct);

// Salons and 営業パートナー (sales partners) share the same catalog; a
// partner just sees their own price where the operator has set one.
const priceFor = (product, salon) =>
  salon?.partnerAccount && product.partnerPrice != null ? product.partnerPrice : product.wholesalePrice;

const mapOrder = (r) => ({
  id: r.id,
  orderNumber: r.order_number,
  salonId: r.salon_id,
  items: r.items,
  subtotal: Number(r.subtotal),
  shipping: Number(r.shipping),
  total: Number(r.total),
  paymentStatus: r.payment_status,
  paymentRequested: r.payment_requested,
  shipStatus: r.ship_status,
  carrier: r.carrier || "",
  trackingNumber: r.tracking_number || "",
  shippedAt: r.shipped_at || "",
  createdAt: fmtDate(r.created_at),
  cancelled: !!r.cancelled_at,
});
const mapOrders = (rows) => (rows || []).map(mapOrder);

const mapBankInfo = (r) =>
  r
    ? {
        bankName: r.bank_name,
        branchName: r.branch_name,
        accountType: r.account_type,
        accountNumber: r.account_number,
        accountHolder: r.account_holder,
        deadlineDays: r.deadline_days,
        issuerName: r.issuer_name || "",
        issuerAddress: r.issuer_address || "",
      }
    : DEFAULT_BANK;

const productToDb = (patch) => {
  const dbPatch = {};
  if ("name" in patch) dbPatch.name = patch.name;
  if ("volume" in patch) dbPatch.volume = patch.volume;
  if ("description" in patch) dbPatch.description = patch.description;
  if ("generalPrice" in patch) dbPatch.general_price = patch.generalPrice;
  if ("wholesalePrice" in patch) dbPatch.wholesale_price = patch.wholesalePrice;
  if ("partnerPrice" in patch) dbPatch.partner_price = patch.partnerPrice === "" ? null : patch.partnerPrice;
  if ("minOrderQty" in patch) dbPatch.min_order_qty = patch.minOrderQty;
  if ("stock" in patch) dbPatch.stock = patch.stock;
  if ("active" in patch) dbPatch.active = patch.active;
  if ("sortOrder" in patch) dbPatch.sort_order = patch.sortOrder;
  if ("imageUrl" in patch) dbPatch.image_url = patch.imageUrl || null;
  return dbPatch;
};

const orderPatchToDb = (patch) => {
  const dbPatch = {};
  if ("paymentStatus" in patch) dbPatch.payment_status = patch.paymentStatus;
  if ("shipStatus" in patch) dbPatch.ship_status = patch.shipStatus;
  if ("shippedAt" in patch) dbPatch.shipped_at = patch.shippedAt;
  if ("carrier" in patch) dbPatch.carrier = patch.carrier;
  if ("trackingNumber" in patch) dbPatch.tracking_number = patch.trackingNumber;
  return dbPatch;
};

/* ============================================================
   SMALL UI PRIMITIVES
============================================================ */
function RingMark({ size = 28, color = C.forest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="16" stroke={color} strokeWidth="2.4" />
      <circle cx="20" cy="20" r="9.5" stroke={color} strokeWidth="1.4" opacity="0.55" />
      <path d="M20 10 C 23 14, 23 18, 20 22 C 17 18, 17 14, 20 10 Z" fill={color} opacity="0.85" />
    </svg>
  );
}

function Btn({ children, variant = "primary", onClick, disabled, type = "button", full, style, icon: Icon }) {
  const base = {
    fontFamily: "'Noto Sans JP', sans-serif",
    fontSize: 14.5,
    fontWeight: 600,
    borderRadius: 3,
    padding: "13px 22px",
    letterSpacing: "0.03em",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid transparent",
    transition: "all 0.15s ease",
    width: full ? "100%" : undefined,
    opacity: disabled ? 0.5 : 1,
  };
  const variants = {
    primary: { background: C.forest, color: C.white, borderColor: C.forest },
    gold: { background: C.gold, color: C.forestDeep, borderColor: C.gold },
    outline: { background: "transparent", color: C.forest, borderColor: C.forest },
    ghost: { background: "transparent", color: C.inkSoft, borderColor: "transparent" },
    danger: { background: "transparent", color: C.clay, borderColor: C.clay },
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.filter = "brightness(0.95)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

function Field({ label, required, children, hint }) {
  return (
    <label style={{ display: "block", marginBottom: 18 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.inkSoft, marginBottom: 7, letterSpacing: "0.04em" }}>
        {label} {required && <span style={{ color: C.clay }}>*</span>}
      </div>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: C.inkSoft, marginTop: 5 }}>{hint}</div>}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  border: `1px solid ${C.line}`,
  borderRadius: 3,
  padding: "12px 14px",
  fontSize: 14.5,
  fontFamily: "'Noto Sans JP', sans-serif",
  color: C.ink,
  background: C.white,
  boxSizing: "border-box",
  outline: "none",
};

function Input(props) {
  return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
}
function TextArea(props) {
  return <textarea {...props} style={{ ...inputStyle, minHeight: 90, resize: "vertical", ...(props.style || {}) }} />;
}

function Card({ children, style, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.white,
        border: `1px solid ${C.line}`,
        borderRadius: 4,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META["注文受付"];
  const Icon = meta.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 20,
      background: meta.color + "18", color: meta.color,
    }}>
      <Icon size={12} /> {status}
    </span>
  );
}

function EmptyState({ title, sub, icon: Icon = Package }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: C.inkSoft }}>
      <Icon size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
      <div style={{ fontFamily: "'Shippori Mincho', serif", fontSize: 16, color: C.ink, marginBottom: 6 }}>{title}</div>
      {sub && <div style={{ fontSize: 13 }}>{sub}</div>}
    </div>
  );
}

function ProductArt({ size = 64, src }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={{
          width: size, height: size, borderRadius: 6, objectFit: "cover",
          border: `1px solid ${C.line}`, flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: 6,
      background: `linear-gradient(155deg, ${C.sage}, ${C.ivory})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      border: `1px solid ${C.line}`, flexShrink: 0,
    }}>
      <div style={{ position: "relative" }}>
        <div style={{ width: size * 0.34, height: size * 0.42, borderRadius: "3px 3px 6px 6px", background: C.forest, opacity: 0.85 }} />
        <div style={{ position: "absolute", top: -size * 0.08, left: "50%", transform: "translateX(-50%)", width: size * 0.4, height: size * 0.1, borderRadius: 2, background: C.gold }} />
      </div>
    </div>
  );
}

/* ============================================================
   HEADER / NAV
============================================================ */
function TopBar({ salon, admin, onLogout, cartCount, view, setView }) {
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 40, background: C.forest,
      color: C.ivory, padding: "0 16px", height: 58,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
    }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}
        onClick={() => setView(admin ? "admin-dashboard" : "top")}
      >
        <RingMark size={22} color={C.ivory} />
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontFamily: "'Shippori Mincho', serif", fontSize: 14.5, fontWeight: 600 }}>よもぎの環</div>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", opacity: 0.8 }}>
            {admin ? "運営者管理画面" : "取扱店様専用サイト"}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {!admin && (
          <div style={{ position: "relative", cursor: "pointer" }} onClick={() => setView("cart")}>
            <ShoppingCart size={20} />
            {cartCount > 0 && (
              <span style={{
                position: "absolute", top: -7, right: -8, background: C.gold, color: C.forestDeep,
                fontSize: 10, fontWeight: 700, borderRadius: 10, minWidth: 16, height: 16,
                display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
              }}>{cartCount}</span>
            )}
          </div>
        )}
        {(salon || admin) && (
          <button onClick={onLogout} style={{ background: "none", border: "none", color: C.ivory, opacity: 0.85, cursor: "pointer", display: "flex" }}>
            <LogOut size={19} />
          </button>
        )}
      </div>
    </div>
  );
}

function BottomNav({ view, setView }) {
  const items = [
    { key: "top", label: "ホーム", icon: Home },
    { key: "products", label: "商品", icon: Package },
    { key: "cart", label: "カート", icon: ShoppingCart },
    { key: "orderHistory", label: "注文履歴", icon: ClipboardList },
    { key: "mypage", label: "マイページ", icon: User },
  ];
  return (
    <div style={{
      position: "sticky", bottom: 0, zIndex: 40, background: C.white,
      borderTop: `1px solid ${C.line}`, display: "flex",
      padding: "6px 4px calc(6px + env(safe-area-inset-bottom))",
    }}>
      {items.map((it) => {
        const active = view === it.key || (it.key === "products" && view === "productDetail");
        return (
          <button
            key={it.key}
            onClick={() => setView(it.key)}
            style={{
              flex: 1, background: "none", border: "none", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              padding: "6px 0", color: active ? C.forest : "#9AA298",
            }}
          >
            <it.icon size={19} strokeWidth={active ? 2.4 : 1.8} />
            <span style={{ fontSize: 10, fontWeight: active ? 700 : 500 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function AdminNav({ view, setView }) {
  const items = [
    { key: "admin-dashboard", label: "ダッシュボード" },
    { key: "admin-salons", label: "サロン管理" },
    { key: "admin-orders", label: "注文管理" },
    { key: "admin-products", label: "商品・在庫" },
    { key: "admin-settings", label: "設定" },
  ];
  return (
    <div style={{ display: "flex", gap: 2, overflowX: "auto", background: C.forestDeep, padding: "0 8px" }}>
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => setView(it.key)}
          style={{
            background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap",
            color: view === it.key ? C.gold : "#C7D2C4",
            fontSize: 13, fontWeight: view === it.key ? 700 : 500,
            padding: "12px 12px", borderBottom: view === it.key ? `2px solid ${C.gold}` : "2px solid transparent",
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Screen({ children, maxWidth = 640 }) {
  return (
    <div style={{ maxWidth, margin: "0 auto", padding: "20px 16px 40px" }}>
      {children}
    </div>
  );
}

function SectionTitle({ eyebrow, title, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 16 }}>
      <div>
        {eyebrow && <div style={{ fontSize: 11, letterSpacing: "0.14em", color: C.gold, fontWeight: 700, marginBottom: 3 }}>{eyebrow}</div>}
        <div style={{ fontFamily: "'Shippori Mincho', serif", fontSize: 19, color: C.ink, fontWeight: 600 }}>{title}</div>
      </div>
      {right}
    </div>
  );
}

/* ============================================================
   AUTH SCREENS
============================================================ */
function LoginScreen({ goRegister }) {
  const [mode, setMode] = useState("salon"); // "salon" | "admin"
  const [salonStep, setSalonStep] = useState("password"); // "password" | "pick"
  const [salonPassword, setSalonPassword] = useState("");
  const [salonList, setSalonList] = useState([]);
  const [selectedSalonId, setSelectedSalonId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const submitSalonPassword = async () => {
    setError("");
    let accountType;
    if (SALON_SHARED_PASSWORD && salonPassword === SALON_SHARED_PASSWORD) accountType = "salon";
    else if (PARTNER_SHARED_PASSWORD && salonPassword === PARTNER_SHARED_PASSWORD) accountType = "partner";
    else {
      setError("パスワードが正しくありません。");
      return;
    }
    setSending(true);
    const { data, error: err } = await supabase
      .from("public_salon_directory")
      .select("*")
      .eq("account_type", accountType)
      .order("salon_name");
    setSending(false);
    if (err || !data || data.length === 0) {
      setError("該当するサロンが見つかりませんでした。運営者にご確認ください。");
      return;
    }
    setSalonList(data);
    setSelectedSalonId(data[0].id);
    setSalonStep("pick");
  };

  const submitSalonLogin = async () => {
    setError("");
    const picked = salonList.find((s) => s.id === selectedSalonId);
    if (!picked) return;
    setSending(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: picked.email,
      password: salonPassword,
    });
    setSending(false);
    if (err) {
      setError("ログインに失敗しました。運営者にご確認ください。");
    }
  };

  const submitAdmin = async () => {
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (err) {
      setError("メールアドレスまたはパスワードが正しくありません。");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(180deg, ${C.forestDeep}, ${C.forest} 45%, ${C.ivory} 45%)` }}>
      <div style={{ padding: "56px 24px 24px", textAlign: "center", color: C.ivory }}>
        <RingMark size={44} color={C.ivory} />
        <div style={{ fontFamily: "'Shippori Mincho', serif", fontSize: 24, fontWeight: 600, marginTop: 14, letterSpacing: "0.05em" }}>
          よもぎの環
        </div>
        <div style={{ fontSize: 12, letterSpacing: "0.18em", opacity: 0.85, marginTop: 4 }}>
          取扱店様専用サイト
        </div>
      </div>

      <div style={{ maxWidth: 420, margin: "0 auto", padding: "0 20px 40px" }}>
        <Card style={{ padding: 28, boxShadow: "0 10px 30px rgba(27,46,34,0.18)" }}>
          {mode === "salon" ? (
            salonStep === "password" ? (
              <>
                <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 20, lineHeight: 1.7 }}>
                  取扱店共通のパスワードを入力してください。
                </div>
                <Field label="パスワード" required>
                  <Input type="password" placeholder="••••••••" value={salonPassword}
                    onChange={(e) => setSalonPassword(e.target.value)} />
                </Field>
                {error && (
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: C.claySoft, color: C.clay, padding: "10px 12px", borderRadius: 4, fontSize: 12.5, marginBottom: 16, lineHeight: 1.6 }}>
                    <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
                  </div>
                )}
                <Btn full icon={Lock} onClick={submitSalonPassword} disabled={sending}>
                  {sending ? "確認中…" : "次へ"}
                </Btn>
                <div style={{ textAlign: "center", marginTop: 18 }}>
                  <button onClick={goRegister} style={{ background: "none", border: "none", color: C.forest, fontWeight: 700, fontSize: 13.5, cursor: "pointer", textDecoration: "underline" }}>
                    取扱店登録はこちら
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 20, lineHeight: 1.7 }}>
                  ご自身のサロンを選択してください。
                </div>
                <Field label="サロン名" required>
                  <select
                    value={selectedSalonId}
                    onChange={(e) => setSelectedSalonId(e.target.value)}
                    style={inputStyle}
                  >
                    {salonList.map((s) => (
                      <option key={s.id} value={s.id}>{s.salon_name}</option>
                    ))}
                  </select>
                </Field>
                {error && <div style={{ color: C.clay, fontSize: 12.5, marginBottom: 14 }}>{error}</div>}
                <Btn full icon={Lock} onClick={submitSalonLogin} disabled={sending}>
                  {sending ? "ログイン中…" : "ログイン"}
                </Btn>
                <div style={{ textAlign: "center", marginTop: 18 }}>
                  <button
                    onClick={() => { setSalonStep("password"); setError(""); }}
                    style={{ background: "none", border: "none", color: C.inkSoft, fontSize: 12.5, cursor: "pointer" }}
                  >
                    ← パスワード入力へ戻る
                  </button>
                </div>
              </>
            )
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.forest, marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
                <ShieldCheck size={16} /> 運営者ログイン
              </div>
              <Field label="メールアドレス" required>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="パスワード" required>
                <Input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {error && <div style={{ color: C.clay, fontSize: 12.5, marginBottom: 14 }}>{error}</div>}
              <Btn full variant="gold" icon={ShieldCheck} onClick={submitAdmin}>管理画面へ</Btn>
            </>
          )}

          <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 22, paddingTop: 16, textAlign: "center" }}>
            <button
              onClick={() => { setMode(mode === "salon" ? "admin" : "salon"); setSalonStep("password"); setError(""); }}
              style={{ background: "none", border: "none", color: C.inkSoft, fontSize: 12, cursor: "pointer" }}
            >
              {mode === "admin" ? "← サロン用ログインへ戻る" : "運営者の方はこちら"}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function RegisterScreen({ onSubmit, goLogin }) {
  const [form, setForm] = useState({
    salonName: "", contactName: "", email: "", phone: "", zip: "", address: "",
    instagram: "", salonUrl: "", desiredProducts: "", notes: "",
  });
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const canSubmit = form.salonName && form.contactName && form.email && form.phone && form.address;

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError("");
    const { error } = await onSubmit(form);
    setSubmitting(false);
    if (error) {
      setSubmitError(
        error.code === "23505" || error.code === "user_already_exists"
          ? "このメールアドレスはすでに登録されています。"
          : "登録に失敗しました。時間をおいて再度お試しください。"
      );
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <div style={{ minHeight: "100vh", background: C.ivory, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Card style={{ padding: 36, textAlign: "center", maxWidth: 400 }}>
          <CheckCircle2 size={38} color={C.forest} style={{ marginBottom: 14 }} />
          <div style={{ fontFamily: "'Shippori Mincho', serif", fontSize: 19, marginBottom: 10 }}>ご登録ありがとうございます</div>
          <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.8, marginBottom: 24 }}>
            運営者の承認後、ログインいただけるようになります。承認まで今しばらくお待ちください。
          </div>
          <Btn full onClick={goLogin}>ログイン画面へ戻る</Btn>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.ivory }}>
      <div style={{ background: C.forest, color: C.ivory, padding: "18px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={goLogin} style={{ background: "none", border: "none", color: C.ivory, cursor: "pointer", display: "flex" }}>
          <ChevronLeft size={20} />
        </button>
        <RingMark size={18} color={C.ivory} />
        <div style={{ fontFamily: "'Shippori Mincho', serif", fontSize: 15 }}>取扱店登録</div>
      </div>
      <Screen maxWidth={520}>
        <div style={{ fontSize: 12.5, color: C.inkSoft, marginBottom: 22, lineHeight: 1.8 }}>
          サロン・店舗・営業パートナーの皆様の仕入れ登録フォームです。ご登録後、運営者が内容を確認し承認いたします。
        </div>
        <Card style={{ padding: 24 }}>
          <Field label="サロン名 / 店舗名" required><Input value={form.salonName} onChange={set("salonName")} placeholder="例）よもぎ蒸しサロン 花" /></Field>
          <Field label="ご担当者名" required><Input value={form.contactName} onChange={set("contactName")} placeholder="例）山田 花子" /></Field>
          <Field label="メールアドレス" required><Input type="email" value={form.email} onChange={set("email")} /></Field>
          <Field label="電話番号" required><Input value={form.phone} onChange={set("phone")} placeholder="090-0000-0000" /></Field>
          <Field label="郵便番号"><Input value={form.zip} onChange={set("zip")} placeholder="000-0000" /></Field>
          <Field label="住所" required><Input value={form.address} onChange={set("address")} placeholder="都道府県から番地まで" /></Field>
          <Field label="Instagramアカウント"><Input value={form.instagram} onChange={set("instagram")} placeholder="@your_account" /></Field>
          <Field label="サロンURL"><Input value={form.salonUrl} onChange={set("salonUrl")} placeholder="https://" /></Field>
          <Field label="希望する取扱商品"><Input value={form.desiredProducts} onChange={set("desiredProducts")} placeholder="例）よもぎの環 入浴剤" /></Field>
          <Field label="その他備考"><TextArea value={form.notes} onChange={set("notes")} /></Field>
          {submitError && <div style={{ color: C.clay, fontSize: 12.5, marginBottom: 14 }}>{submitError}</div>}
          <Btn full disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? "登録中…" : "登録する"}
          </Btn>
        </Card>
      </Screen>
    </div>
  );
}

/* ============================================================
   SALON: TOP PAGE
============================================================ */
function TopPage({ salon, products, orders, setView }) {
  const myOrders = orders.filter((o) => o.salonId === salon.id);
  const activeOrder = [...myOrders].reverse().find((o) => deriveOrderStatus(o) !== "発送済");
  const newest = [...products].filter(p => p.active).slice(-2).reverse();
  const featured = products.filter(p => p.active)[0];

  return (
    <Screen>
      <div style={{
        background: `linear-gradient(135deg, ${C.forest}, ${C.forestDeep})`,
        borderRadius: 6, padding: "26px 22px", color: C.ivory, marginBottom: 26, position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", right: -20, top: -20, opacity: 0.15 }}><RingMark size={130} color={C.ivory} /></div>
        <div style={{ fontSize: 11, letterSpacing: "0.14em", color: C.goldSoft, fontWeight: 700, marginBottom: 6 }}>WELCOME</div>
        <div style={{ fontFamily: "'Shippori Mincho', serif", fontSize: 20, marginBottom: 8, lineHeight: 1.5 }}>
          {salon.salonName} 様
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.85, lineHeight: 1.8 }}>
          いつもよもぎの環をお取り扱いいただき、ありがとうございます。
        </div>
      </div>

      <SectionTitle eyebrow="ORDER STATUS" title="現在の注文状況" />
      {activeOrder ? (
        <Card style={{ padding: 18, marginBottom: 28 }} onClick={() => setView("orderHistory")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, color: C.inkSoft }}>{activeOrder.orderNumber}</div>
            <StatusPill status={deriveOrderStatus(activeOrder)} />
          </div>
          <div style={{ fontSize: 13.5, color: C.ink }}>{activeOrder.items.map(i => i.name).join("、")}</div>
          <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 4 }}>合計 {yen(activeOrder.total)}</div>
        </Card>
      ) : (
        <div style={{ marginBottom: 28 }}>
          <EmptyState title="進行中の注文はありません" sub="新しく注文を作成できます" icon={ClipboardList} />
        </div>
      )}

      <SectionTitle eyebrow="PRODUCTS" title="新着・おすすめ商品" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 }}>
        {(newest.length ? newest : featured ? [featured] : []).map((p) => (
          <Card key={p.id} style={{ padding: 14, cursor: "pointer" }} onClick={() => setView("productDetail", p.id)}>
            <ProductArt size={56} src={p.imageUrl} />
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, marginTop: 10, lineHeight: 1.4 }}>{p.name}</div>
            <div style={{ fontSize: 12, color: C.gold, fontWeight: 700, marginTop: 4 }}>{yen(priceFor(p, salon))}〜</div>
          </Card>
        ))}
      </div>

      <SectionTitle eyebrow="NOTICE" title="お知らせ" />
      <Card style={{ padding: 16, marginBottom: 28, fontSize: 12.5, color: C.inkSoft, lineHeight: 1.8 }}>
        銀行振込のご入金確認後、順次発送いたします。ご注文からお振込までは
        <b style={{ color: C.ink }}> 7日以内 </b>にお願いしております。
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Btn full icon={Package} onClick={() => setView("products")}>商品を見る</Btn>
        <Btn full variant="outline" icon={ClipboardList} onClick={() => setView("orderHistory")}>注文履歴を見る</Btn>
      </div>
    </Screen>
  );
}

/* ============================================================
   SALON: PRODUCT LIST / DETAIL
============================================================ */
function ProductListScreen({ products, cart, setCart, salon, setView }) {
  const [qtyMap, setQtyMap] = useState({});
  const activeProducts = products.filter((p) => p.active);

  const getQty = (p) => qtyMap[p.id] ?? p.minOrderQty;
  const addToCart = (p) => {
    const qty = Math.max(getQty(p), p.minOrderQty);
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === p.id);
      if (existing) {
        return prev.map((c) => (c.productId === p.id ? { ...c, qty: c.qty + qty } : c));
      }
      return [...prev, { productId: p.id, qty }];
    });
  };

  return (
    <Screen>
      <SectionTitle eyebrow="CATALOG" title="商品一覧" />
      {activeProducts.length === 0 && <EmptyState title="現在お取り扱いできる商品がありません" />}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {activeProducts.map((p) => (
          <Card key={p.id} style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 14 }} onClick={() => setView("productDetail", p.id)}>
              <ProductArt size={72} src={p.imageUrl} />
              <div style={{ flex: 1, cursor: "pointer" }}>
                <div style={{ fontFamily: "'Shippori Mincho', serif", fontSize: 15.5, color: C.ink, marginBottom: 3 }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: C.inkSoft, marginBottom: 6 }}>{p.volume}</div>
                <div style={{ fontSize: 11.5, color: p.stock > 0 ? C.forestSoft : C.clay, fontWeight: 600 }}>
                  {p.stock > 0 ? `在庫あり（${p.stock}）` : "在庫切れ"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10.5, color: C.inkSoft, textDecoration: "line-through" }}>{yen(p.generalPrice)}</div>
                <div style={{ fontSize: 16, color: C.forest, fontWeight: 700 }}>{yen(priceFor(p, salon))}</div>
                <div style={{ fontSize: 10, color: C.inkSoft }}>{salon?.partnerAccount ? "パートナー価格" : "卸価格"} / 税込</div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
              <div style={{ fontSize: 11, color: C.inkSoft }}>最低{p.minOrderQty}個〜</div>
              <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.line}`, borderRadius: 3, marginLeft: "auto" }}>
                <button onClick={() => setQtyMap({ ...qtyMap, [p.id]: Math.max(p.minOrderQty, getQty(p) - 1) })}
                  style={{ border: "none", background: "none", padding: "6px 10px", cursor: "pointer", color: C.forest }}>
                  <Minus size={14} />
                </button>
                <div style={{ minWidth: 30, textAlign: "center", fontSize: 13.5, fontWeight: 600 }}>{getQty(p)}</div>
                <button onClick={() => setQtyMap({ ...qtyMap, [p.id]: getQty(p) + 1 })}
                  style={{ border: "none", background: "none", padding: "6px 10px", cursor: "pointer", color: C.forest }}>
                  <Plus size={14} />
                </button>
              </div>
              <Btn variant="primary" onClick={() => addToCart(p)} disabled={p.stock <= 0} style={{ padding: "10px 14px" }}>
                カートに入れる
              </Btn>
            </div>
          </Card>
        ))}
      </div>
    </Screen>
  );
}

function ProductDetailScreen({ product, setCart, salon, setView }) {
  const [qty, setQty] = useState(product?.minOrderQty || 1);
  if (!product) return <Screen><EmptyState title="商品が見つかりません" /></Screen>;

  const addToCart = () => {
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === product.id);
      if (existing) return prev.map((c) => (c.productId === product.id ? { ...c, qty: c.qty + qty } : c));
      return [...prev, { productId: product.id, qty }];
    });
    setView("cart");
  };

  return (
    <Screen>
      <button onClick={() => setView("products")} style={{ background: "none", border: "none", color: C.forest, display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer", marginBottom: 16 }}>
        <ChevronLeft size={16} /> 商品一覧へ戻る
      </button>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
        <ProductArt size={160} src={product.imageUrl} />
      </div>
      <div style={{ fontFamily: "'Shippori Mincho', serif", fontSize: 21, color: C.ink, marginBottom: 4 }}>{product.name}</div>
      <div style={{ fontSize: 12.5, color: C.inkSoft, marginBottom: 14 }}>{product.volume}</div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.forest }}>{yen(priceFor(product, salon))}</div>
        <div style={{ fontSize: 12, color: C.inkSoft, textDecoration: "line-through" }}>一般価格 {yen(product.generalPrice)}</div>
      </div>

      <Card style={{ padding: 16, marginBottom: 20, background: C.sage, border: "none" }}>
        <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.9 }}>{product.description}</div>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: C.inkSoft, marginBottom: 20 }}>
        <span>最低注文数：{product.minOrderQty}個</span>
        <span style={{ color: product.stock > 0 ? C.forestSoft : C.clay, fontWeight: 600 }}>
          {product.stock > 0 ? `在庫あり（${product.stock}個）` : "在庫切れ"}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: C.ink, fontWeight: 600 }}>数量</div>
        <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.line}`, borderRadius: 3 }}>
          <button onClick={() => setQty(Math.max(product.minOrderQty, qty - 1))} style={{ border: "none", background: "none", padding: "9px 14px", cursor: "pointer", color: C.forest }}><Minus size={15} /></button>
          <div style={{ minWidth: 36, textAlign: "center", fontSize: 15, fontWeight: 600 }}>{qty}</div>
          <button onClick={() => setQty(qty + 1)} style={{ border: "none", background: "none", padding: "9px 14px", cursor: "pointer", color: C.forest }}><Plus size={15} /></button>
        </div>
      </div>

      <Btn full icon={ShoppingCart} onClick={addToCart} disabled={product.stock <= 0}>カートに入れる</Btn>
    </Screen>
  );
}

/* ============================================================
   SALON: CART / CHECKOUT / COMPLETE
============================================================ */
const SHIPPING_FEE = 800;
const FREE_SHIP_THRESHOLD = 30000;

function calcCartTotals(cart, products, salon) {
  const items = cart.map((c) => {
    const p = products.find((pp) => pp.id === c.productId);
    if (!p) return null;
    const unitPrice = priceFor(p, salon);
    return { productId: p.id, name: p.name, imageUrl: p.imageUrl, unitPrice, qty: c.qty, subtotal: unitPrice * c.qty };
  }).filter(Boolean);
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const shipping = subtotal === 0 || subtotal >= FREE_SHIP_THRESHOLD ? 0 : SHIPPING_FEE;
  const total = subtotal + shipping;
  return { items, subtotal, shipping, total };
}

function CartScreen({ cart, setCart, products, salon, setView }) {
  const { items, subtotal, shipping, total } = calcCartTotals(cart, products, salon);
  const updateQty = (id, qty) => {
    if (qty <= 0) { setCart(cart.filter((c) => c.productId !== id)); return; }
    setCart(cart.map((c) => (c.productId === id ? { ...c, qty } : c)));
  };
  return (
    <Screen>
      <SectionTitle eyebrow="CART" title="カート" />
      {items.length === 0 ? (
        <EmptyState title="カートに商品がありません" sub="商品一覧からお選びください" icon={ShoppingCart} />
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 22 }}>
            {items.map((i) => (
              <Card key={i.productId} style={{ padding: 14, display: "flex", gap: 12, alignItems: "center" }}>
                <ProductArt size={52} src={i.imageUrl} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink, marginBottom: 4 }}>{i.name}</div>
                  <div style={{ fontSize: 12, color: C.inkSoft }}>単価 {yen(i.unitPrice)}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.line}`, borderRadius: 3 }}>
                  <button onClick={() => updateQty(i.productId, i.qty - 1)} style={{ border: "none", background: "none", padding: "5px 9px", cursor: "pointer", color: C.forest }}><Minus size={13} /></button>
                  <div style={{ minWidth: 26, textAlign: "center", fontSize: 13 }}>{i.qty}</div>
                  <button onClick={() => updateQty(i.productId, i.qty + 1)} style={{ border: "none", background: "none", padding: "5px 9px", cursor: "pointer", color: C.forest }}><Plus size={13} /></button>
                </div>
                <button onClick={() => updateQty(i.productId, 0)} style={{ border: "none", background: "none", cursor: "pointer", color: C.clay }}><Trash2 size={16} /></button>
              </Card>
            ))}
          </div>

          <Card style={{ padding: 18, marginBottom: 20 }}>
            <Row label="小計" value={yen(subtotal)} />
            <Row label="送料" value={shipping === 0 ? "無料" : yen(shipping)} sub={shipping > 0 ? `¥${FREE_SHIP_THRESHOLD.toLocaleString()}以上のご注文で送料無料` : null} />
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>合計金額</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: C.forest }}>{yen(total)}</span>
            </div>
          </Card>

          <Btn full icon={ArrowRight} onClick={() => setView("checkout")}>注文内容の確認へ進む</Btn>
        </>
      )}
    </Screen>
  );
}

function Row({ label, value, sub }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.ink }}>
        <span>{label}</span><span>{value}</span>
      </div>
      {sub && <div style={{ fontSize: 10.5, color: C.inkSoft, textAlign: "right", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function CheckoutScreen({ salon, cart, products, bankInfo, onConfirm, setView }) {
  const { items, subtotal, shipping, total } = calcCartTotals(cart, products, salon);
  return (
    <Screen>
      <SectionTitle eyebrow="CONFIRM" title="注文内容の確認" />

      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft, marginBottom: 8 }}>ご注文者情報</div>
      <Card style={{ padding: 16, marginBottom: 20, fontSize: 13, lineHeight: 2 }}>
        <div>{salon.salonName}（{salon.contactName} 様）</div>
        <div style={{ color: C.inkSoft }}>{salon.address}</div>
        <div style={{ color: C.inkSoft }}>{salon.phone} ／ {salon.email}</div>
      </Card>

      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft, marginBottom: 8 }}>ご注文商品</div>
      <Card style={{ padding: 16, marginBottom: 20 }}>
        {items.map((i) => (
          <div key={i.productId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
            <span>{i.name} × {i.qty}</span>
            <span>{yen(i.subtotal)}</span>
          </div>
        ))}
        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 10, paddingTop: 10 }}>
          <Row label="小計" value={yen(subtotal)} />
          <Row label="送料" value={shipping === 0 ? "無料" : yen(shipping)} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <span style={{ fontWeight: 700 }}>合計金額</span>
            <span style={{ fontWeight: 700, fontSize: 17, color: C.forest }}>{yen(total)}</span>
          </div>
        </div>
      </Card>

      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft, marginBottom: 8 }}>お支払い方法</div>
      <Card style={{ padding: 16, marginBottom: 28, fontSize: 12.5, color: C.ink, lineHeight: 1.9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontWeight: 700 }}>
          <Banknote size={16} color={C.forest} /> 銀行振込
        </div>
        振込先情報は、注文確定後の画面と確認メールにてご案内いたします。ご注文から
        {bankInfo.deadlineDays}日以内のお振込をお願いいたします。
      </Card>

      <Btn full icon={CheckCircle2} onClick={onConfirm}>この内容で注文する</Btn>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <button onClick={() => setView("cart")} style={{ background: "none", border: "none", color: C.inkSoft, fontSize: 12.5, cursor: "pointer" }}>カートに戻る</button>
      </div>
    </Screen>
  );
}

function CompleteScreen({ order, bankInfo, setView }) {
  if (!order) return <Screen><EmptyState title="注文情報が見つかりません" /></Screen>;
  return (
    <Screen>
      <div style={{ textAlign: "center", padding: "20px 0 28px" }}>
        <CheckCircle2 size={44} color={C.forest} />
        <div style={{ fontFamily: "'Shippori Mincho', serif", fontSize: 19, marginTop: 14, marginBottom: 8 }}>
          ご注文ありがとうございます。
        </div>
        <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.9 }}>
          お振込確認後、発送いたします。<br />ご注文番号：<b style={{ color: C.ink }}>{order.orderNumber}</b>
        </div>
      </div>

      <Card style={{ padding: 18, marginBottom: 20, background: C.sage, border: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13.5, color: C.forest, marginBottom: 12 }}>
          <Banknote size={17} /> お振込先情報
        </div>
        <BankInfoTable bankInfo={bankInfo} />
        <div style={{ fontSize: 11.5, color: C.clay, marginTop: 12 }}>
          お振込期限：ご注文日より{bankInfo.deadlineDays}日以内
        </div>
      </Card>

      <Card style={{ padding: 16, marginBottom: 24, fontSize: 13 }}>
        <Row label="小計" value={yen(order.subtotal)} />
        <Row label="送料" value={order.shipping === 0 ? "無料" : yen(order.shipping)} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
          <span style={{ fontWeight: 700 }}>合計金額</span>
          <span style={{ fontWeight: 700, color: C.forest }}>{yen(order.total)}</span>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Btn full variant="outline" onClick={() => setView("orderHistory")}>注文履歴を見る</Btn>
        <Btn full onClick={() => setView("top")}>トップへ戻る</Btn>
      </div>
    </Screen>
  );
}

function BankInfoTable({ bankInfo }) {
  const rows = [
    ["銀行名", bankInfo.bankName], ["支店名", bankInfo.branchName],
    ["口座種別", bankInfo.accountType], ["口座番号", bankInfo.accountNumber],
    ["口座名義", bankInfo.accountHolder],
  ];
  return (
    <div style={{ fontSize: 13 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px dashed ${C.line}` }}>
          <span style={{ color: C.inkSoft }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   SALON: MYPAGE / ORDER HISTORY
============================================================ */
function MyPageScreen({ salon, orders, setView }) {
  const myOrders = orders.filter((o) => o.salonId === salon.id);
  const totalSpent = myOrders.reduce((s, o) => s + o.total, 0);
  return (
    <Screen>
      <SectionTitle eyebrow="MY PAGE" title="マイページ" />
      <Card style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: C.sage, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Building2 size={20} color={C.forest} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{salon.salonName}</div>
            <div style={{ fontSize: 12, color: C.inkSoft }}>{salon.contactName} 様</div>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 2 }}>
          <div><Mail size={12} style={{ display: "inline", marginRight: 6 }} />{salon.email}</div>
          <div><Phone size={12} style={{ display: "inline", marginRight: 6 }} />{salon.phone}</div>
          <div><MapPin size={12} style={{ display: "inline", marginRight: 6 }} />{salon.address}</div>
          {salon.instagram && <div><Instagram size={12} style={{ display: "inline", marginRight: 6 }} />{salon.instagram}</div>}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
        <Card style={{ padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: C.inkSoft, marginBottom: 4 }}>注文回数</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.forest }}>{myOrders.length}</div>
        </Card>
        <Card style={{ padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: C.inkSoft, marginBottom: 4 }}>累計お取引額</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.forest }}>{yen(totalSpent)}</div>
        </Card>
      </div>

      <Btn full variant="outline" icon={ClipboardList} onClick={() => setView("orderHistory")}>注文履歴を見る</Btn>
    </Screen>
  );
}

function OrderHistoryScreen({ salon, orders, setView }) {
  const myOrders = [...orders].filter((o) => o.salonId === salon.id).reverse();
  return (
    <Screen>
      <SectionTitle eyebrow="HISTORY" title="注文履歴" />
      {myOrders.length === 0 ? (
        <EmptyState title="ご注文履歴はまだありません" icon={ClipboardList} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {myOrders.map((o) => (
            <Card key={o.id} style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 11.5, color: C.inkSoft }}>{o.createdAt}</div>
                <StatusPill status={deriveOrderStatus(o)} />
              </div>
              <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 6 }}>{o.orderNumber}</div>
              <div style={{ fontSize: 13.5, color: C.ink, marginBottom: 6 }}>
                {o.items.map((i) => `${i.name} ×${i.qty}`).join("、")}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.forest }}>{yen(o.total)}</div>
              {o.shipStatus === "発送済" && o.trackingNumber && (
                <div style={{ fontSize: 11.5, color: C.inkSoft, marginTop: 8, borderTop: `1px dashed ${C.line}`, paddingTop: 8 }}>
                  {o.carrier} 追跡番号：{o.trackingNumber}（発送日 {o.shippedAt}）
                </div>
              )}
              <OrderProgress status={deriveOrderStatus(o)} />
            </Card>
          ))}
        </div>
      )}
    </Screen>
  );
}

function OrderProgress({ status }) {
  if (status === "キャンセル") return null;
  const idx = STATUS_FLOW.indexOf(status);
  return (
    <div style={{ display: "flex", alignItems: "center", marginTop: 12 }}>
      {STATUS_FLOW.map((s, i) => (
        <React.Fragment key={s}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: i <= idx ? C.forest : C.line, flexShrink: 0,
          }} />
          {i < STATUS_FLOW.length - 1 && (
            <div style={{ flex: 1, height: 2, background: i < idx ? C.forest : C.line }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ============================================================
   ADMIN SCREENS
============================================================ */
function AdminDashboard({ salons, orders, products, setView }) {
  const liveOrders = orders.filter((o) => !o.cancelled);
  const pendingSalons = salons.filter((s) => s.status === "pending").length;
  const unpaidOrders = liveOrders.filter((o) => o.paymentStatus !== "入金確認済").length;
  const toShip = liveOrders.filter((o) => o.paymentStatus === "入金確認済" && o.shipStatus !== "発送済").length;
  const revenue = liveOrders.filter(o => o.paymentStatus === "入金確認済").reduce((s, o) => s + o.total, 0);

  const stats = [
    { label: "承認待ちサロン", value: pendingSalons, icon: Building2, tone: pendingSalons > 0 ? C.clay : C.forestSoft, go: "admin-salons" },
    { label: "入金確認待ち", value: unpaidOrders, icon: Banknote, tone: unpaidOrders > 0 ? C.clay : C.forestSoft, go: "admin-orders" },
    { label: "発送待ち", value: toShip, icon: Truck, tone: toShip > 0 ? C.gold : C.forestSoft, go: "admin-orders" },
    { label: "確定売上合計", value: yen(revenue), icon: Sparkles, tone: C.forest, go: "admin-orders" },
  ];

  return (
    <Screen maxWidth={860}>
      <SectionTitle eyebrow="ADMIN" title="ダッシュボード" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 30 }}>
        {stats.map((s) => (
          <Card key={s.label} style={{ padding: 18, cursor: "pointer" }} onClick={() => setView(s.go)}>
            <s.icon size={18} color={s.tone} />
            <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginTop: 10 }}>{s.value}</div>
            <div style={{ fontSize: 11.5, color: C.inkSoft, marginTop: 2 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      <SectionTitle title="最近の注文" right={<button onClick={() => setView("admin-orders")} style={{ background: "none", border: "none", color: C.forest, fontSize: 12.5, cursor: "pointer" }}>すべて見る</button>} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[...orders].reverse().slice(0, 5).map((o) => {
          const s = salons.find((x) => x.id === o.salonId);
          return (
            <Card key={o.id} style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s?.salonName || "不明"}</div>
                <div style={{ fontSize: 11.5, color: C.inkSoft }}>{o.orderNumber} ・ {o.createdAt}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{yen(o.total)}</div>
                <StatusPill status={deriveOrderStatus(o)} />
              </div>
            </Card>
          );
        })}
        {orders.length === 0 && <EmptyState title="注文はまだありません" />}
      </div>
    </Screen>
  );
}

function AdminSalons({ salons, updateSalon }) {
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const list = salons.filter((s) => filter === "all" || s.status === filter);

  return (
    <Screen maxWidth={860}>
      <SectionTitle eyebrow="ADMIN" title="サロン管理" />
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {[["all", "すべて"], ["pending", "承認待ち"], ["approved", "承認済"]].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            border: `1px solid ${filter === k ? C.forest : C.line}`, background: filter === k ? C.forest : C.white,
            color: filter === k ? C.white : C.ink, borderRadius: 20, padding: "6px 14px", fontSize: 12, cursor: "pointer",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {list.map((s) => (
          <Card key={s.id} style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", cursor: "pointer" }}
              onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{s.salonName}</div>
                  {s.partnerAccount && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: C.gold + "20", color: C.gold }}>
                      パートナー
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 2 }}>{s.contactName} ・ {s.email}</div>
                <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 2 }}>登録日：{s.registeredAt}</div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
                background: s.status === "approved" ? C.forest + "18" : C.clay + "18",
                color: s.status === "approved" ? C.forestSoft : C.clay,
              }}>
                {s.status === "approved" ? "承認済" : "未承認"}
              </span>
            </div>

            {expanded === s.id && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}`, fontSize: 12.5, color: C.ink, lineHeight: 2 }}>
                <div>電話：{s.phone}</div>
                <div>住所：〒{s.zip} {s.address}</div>
                {s.instagram && <div>Instagram：{s.instagram}</div>}
                {s.salonUrl && <div>URL：{s.salonUrl}</div>}
                {s.desiredProducts && <div>希望商品：{s.desiredProducts}</div>}
                {s.notes && <div>備考：{s.notes}</div>}
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: C.inkSoft, marginBottom: 5 }}>区分</div>
                  <select
                    value={s.partnerAccount ? "partner" : "salon"}
                    onChange={(e) => updateSalon(s.id, { partnerAccount: e.target.value === "partner" })}
                    style={{ fontSize: 12.5, padding: "6px 8px", borderRadius: 3, border: `1px solid ${C.line}` }}
                  >
                    <option value="salon">サロン</option>
                    <option value="partner">営業パートナー</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  {s.status !== "approved" ? (
                    <Btn onClick={() => updateSalon(s.id, { status: "approved" })} icon={CheckCircle2}>承認する</Btn>
                  ) : (
                    <Btn variant="outline" onClick={() => updateSalon(s.id, { status: "pending" })}>承認を取り消す</Btn>
                  )}
                </div>
              </div>
            )}
          </Card>
        ))}
        {list.length === 0 && <EmptyState title="該当するサロンがありません" />}
      </div>
    </Screen>
  );
}

function AdminOrders({ orders, salons, updateOrder, cancelOrder, setView }) {
  const [filter, setFilter] = useState("all");
  const filtered = [...orders].reverse().filter((o) => filter === "all" || deriveOrderStatus(o) === filter);

  return (
    <Screen maxWidth={860}>
      <SectionTitle eyebrow="ADMIN" title="注文管理" />
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <button onClick={() => setFilter("all")} style={{
          border: `1px solid ${filter === "all" ? C.forest : C.line}`, background: filter === "all" ? C.forest : C.white,
          color: filter === "all" ? C.white : C.ink, borderRadius: 20, padding: "6px 14px", fontSize: 12, cursor: "pointer",
        }}>すべて</button>
        {[...STATUS_FLOW, "キャンセル"].map((s) => (
          <button key={s} onClick={() => setFilter(s)} style={{
            border: `1px solid ${filter === s ? C.forest : C.line}`, background: filter === s ? C.forest : C.white,
            color: filter === s ? C.white : C.ink, borderRadius: 20, padding: "6px 14px", fontSize: 12, cursor: "pointer",
          }}>{s}</button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.map((o) => {
          const s = salons.find((x) => x.id === o.salonId);
          return (
            <Card key={o.id} style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s?.salonName || "不明なサロン"}</div>
                  <div style={{ fontSize: 11.5, color: C.inkSoft }}>{o.orderNumber} ・ {o.createdAt}</div>
                </div>
                <StatusPill status={deriveOrderStatus(o)} />
              </div>
              <div style={{ fontSize: 12.5, color: C.ink, marginBottom: 10 }}>
                {o.items.map((i) => `${i.name}×${i.qty}`).join("、")} ／ 合計 {yen(o.total)}
              </div>

              {o.cancelled ? (
                <div style={{ fontSize: 12.5, color: C.clay, background: C.claySoft, borderRadius: 4, padding: 12 }}>
                  この注文はキャンセル済みです。在庫は元に戻されています。
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap", background: C.ivory, borderRadius: 4, padding: 12 }}>
                    <div>
                      <div style={{ fontSize: 10.5, color: C.inkSoft, marginBottom: 5 }}>入金状況</div>
                      <select value={o.paymentStatus} onChange={(e) => updateOrder(o.id, { paymentStatus: e.target.value })}
                        style={{ fontSize: 12.5, padding: "6px 8px", borderRadius: 3, border: `1px solid ${C.line}` }}>
                        <option value="未入金">未入金</option>
                        <option value="入金確認済">入金確認済</option>
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: C.inkSoft, marginBottom: 5 }}>発送状況</div>
                      <select value={o.shipStatus} onChange={(e) => updateOrder(o.id, { shipStatus: e.target.value })}
                        style={{ fontSize: 12.5, padding: "6px 8px", borderRadius: 3, border: `1px solid ${C.line}` }}>
                        <option value="未発送">未発送</option>
                        <option value="発送準備中">発送準備中</option>
                        <option value="発送済">発送済</option>
                      </select>
                    </div>
                  </div>

                  {o.shipStatus === "発送済" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
                      <Input placeholder="発送日" defaultValue={o.shippedAt || todayStr()} onBlur={(e) => updateOrder(o.id, { shippedAt: e.target.value })} style={{ fontSize: 12, padding: "8px 10px" }} />
                      <Input placeholder="配送会社" defaultValue={o.carrier} onBlur={(e) => updateOrder(o.id, { carrier: e.target.value })} style={{ fontSize: 12, padding: "8px 10px" }} />
                      <Input placeholder="追跡番号" defaultValue={o.trackingNumber} onBlur={(e) => updateOrder(o.id, { trackingNumber: e.target.value })} style={{ fontSize: 12, padding: "8px 10px" }} />
                    </div>
                  )}
                </>
              )}

              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn variant="outline" icon={Banknote} onClick={() => setView("admin-receipt", o.id)} style={{ padding: "8px 14px", fontSize: 12.5 }}>
                  領収書を発行
                </Btn>
                {!o.cancelled && (
                  <Btn
                    variant="danger"
                    icon={X}
                    onClick={() => {
                      if (window.confirm(`注文 ${o.orderNumber} をキャンセルしますか？在庫が元に戻ります。`)) {
                        cancelOrder(o.id);
                      }
                    }}
                    style={{ padding: "8px 14px", fontSize: 12.5 }}
                  >
                    キャンセルする
                  </Btn>
                )}
              </div>
            </Card>
          );
        })}
        {filtered.length === 0 && <EmptyState title="該当する注文がありません" />}
      </div>
    </Screen>
  );
}

function ReceiptScreen({ order, salon, bankInfo, setView }) {
  if (!order || !salon) {
    return (
      <Screen>
        <EmptyState title="領収書を表示できません" sub="対象の注文が見つかりませんでした" />
      </Screen>
    );
  }
  return (
    <div style={{ minHeight: "100vh", background: C.ivory }}>
      <style>{`
        @media print {
          .print-hide { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>
      <div className="print-hide" style={{ padding: 16, display: "flex", gap: 10, maxWidth: 640, margin: "0 auto" }}>
        <Btn variant="outline" icon={ChevronLeft} onClick={() => setView("admin-orders")}>注文管理へ戻る</Btn>
        <Btn icon={Banknote} onClick={() => window.print()}>印刷 / PDF保存</Btn>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 32px 60px", background: C.white, boxShadow: "0 1px 0 rgba(0,0,0,0.05)" }}>
        <div style={{ textAlign: "center", fontFamily: "'Shippori Mincho', serif", fontSize: 24, fontWeight: 700, letterSpacing: "0.3em", marginBottom: 32 }}>
          領収書
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 30, fontSize: 12.5, color: C.inkSoft }}>
          <div>領収書番号：{order.orderNumber}</div>
          <div>発行日：{todayStr()}</div>
        </div>

        <div style={{ fontSize: 18, fontWeight: 600, borderBottom: `2px solid ${C.ink}`, paddingBottom: 10, marginBottom: 26 }}>
          {salon.salonName} 御中
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 10, borderBottom: `1px solid ${C.line}`, paddingBottom: 18, marginBottom: 18 }}>
          <div style={{ fontSize: 13, color: C.inkSoft }}>金額</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: C.forest }}>{yen(order.total)}</div>
          <div style={{ fontSize: 13, color: C.inkSoft }}>（税込）</div>
        </div>

        <div style={{ fontSize: 13.5, marginBottom: 30 }}>
          但し　{order.items.map((i) => i.name).join("、")}　代金として
        </div>

        <Card style={{ padding: 16, marginBottom: 40, fontSize: 12.5 }}>
          <Row label="商品代金" value={yen(order.subtotal)} />
          <Row label="送料" value={order.shipping === 0 ? "無料" : yen(order.shipping)} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, borderTop: `1px solid ${C.line}`, paddingTop: 8, fontWeight: 700 }}>
            <span>合計</span><span>{yen(order.total)}</span>
          </div>
        </Card>

        <div style={{ textAlign: "right", fontSize: 13, lineHeight: 1.9 }}>
          <div style={{ fontWeight: 700 }}>{bankInfo.issuerName || "（発行者名が未設定です。設定画面からご入力ください）"}</div>
          {bankInfo.issuerAddress && <div style={{ color: C.inkSoft }}>{bankInfo.issuerAddress}</div>}
        </div>
      </div>
    </div>
  );
}

function AdminProducts({ products, updateProduct, addProduct, moveProduct }) {
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  return (
    <Screen maxWidth={860}>
      <SectionTitle eyebrow="ADMIN" title="商品・在庫管理" right={
        <Btn icon={Plus} onClick={() => setCreating(true)}>商品を追加</Btn>
      } />

      {creating && (
        <ProductEditForm
          onCancel={() => setCreating(false)}
          onSave={(data) => { addProduct(data); setCreating(false); }}
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {products.map((p, idx) => (
          <Card key={p.id} style={{ padding: 16 }}>
            {editing === p.id ? (
              <ProductEditForm
                initial={p}
                onCancel={() => setEditing(null)}
                onSave={(data) => { updateProduct(p.id, data); setEditing(null); }}
              />
            ) : (
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <button
                    onClick={() => moveProduct(p.id, "up")}
                    disabled={idx === 0}
                    style={{ border: `1px solid ${C.line}`, background: C.white, borderRadius: 3, padding: "2px 6px", cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.35 : 1, fontSize: 11, lineHeight: 1.4 }}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveProduct(p.id, "down")}
                    disabled={idx === products.length - 1}
                    style={{ border: `1px solid ${C.line}`, background: C.white, borderRadius: 3, padding: "2px 6px", cursor: idx === products.length - 1 ? "default" : "pointer", opacity: idx === products.length - 1 ? 0.35 : 1, fontSize: 11, lineHeight: 1.4 }}
                  >
                    ↓
                  </button>
                </div>
                <ProductArt size={56} src={p.imageUrl} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: C.inkSoft }}>{p.volume}</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    卸 {yen(p.wholesalePrice)} ／ パートナー {p.partnerPrice == null ? "卸価格と同じ" : yen(p.partnerPrice)} ／ 一般 {yen(p.generalPrice)} ／ 在庫 {p.stock} ／ 最低{p.minOrderQty}個
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: p.active ? C.forestSoft : C.clay }}>
                    {p.active ? "販売中" : "販売停止"}
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setEditing(p.id)} style={{ border: `1px solid ${C.line}`, background: C.white, borderRadius: 3, padding: 6, cursor: "pointer" }}><Edit3 size={13} /></button>
                    <button onClick={() => updateProduct(p.id, { active: !p.active })} style={{ border: `1px solid ${C.line}`, background: C.white, borderRadius: 3, padding: 6, cursor: "pointer" }}>
                      {p.active ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </Screen>
  );
}

function ProductEditForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({
    name: "", volume: "", description: "", generalPrice: 0, wholesalePrice: 0, minOrderQty: 1, stock: 0, active: true,
    ...initial,
    partnerPrice: initial?.partnerPrice ?? "",
    imageUrl: initial?.imageUrl || "",
  });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setNum = (k) => (e) => setF({ ...f, [k]: Number(e.target.value) });

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    const ext = file.name.split(".").pop();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file);
    setUploading(false);
    if (error) {
      setUploadError("画像のアップロードに失敗しました。");
      return;
    }
    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    setF((prev) => ({ ...prev, imageUrl: data.publicUrl }));
  };

  return (
    <Card style={{ padding: 18, marginBottom: 16, background: C.sage, border: "none" }}>
      <Field label="商品画像">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ProductArt size={64} src={f.imageUrl} />
          <div>
            <input type="file" accept="image/*" onChange={handleImageChange} disabled={uploading} style={{ fontSize: 12.5 }} />
            {uploading && <div style={{ fontSize: 11.5, color: C.inkSoft, marginTop: 4 }}>アップロード中…</div>}
            {uploadError && <div style={{ fontSize: 11.5, color: C.clay, marginTop: 4 }}>{uploadError}</div>}
            {f.imageUrl && (
              <button
                type="button"
                onClick={() => setF((prev) => ({ ...prev, imageUrl: "" }))}
                style={{ background: "none", border: "none", color: C.clay, fontSize: 11.5, cursor: "pointer", padding: 0, marginTop: 4 }}
              >
                画像を削除
              </button>
            )}
          </div>
        </div>
      </Field>
      <Field label="商品名"><Input value={f.name} onChange={set("name")} /></Field>
      <Field label="内容量"><Input value={f.volume} onChange={set("volume")} /></Field>
      <Field label="商品説明"><TextArea value={f.description} onChange={set("description")} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="一般販売価格（円）"><Input type="number" value={f.generalPrice} onChange={setNum("generalPrice")} /></Field>
        <Field label="サロン卸価格（円）"><Input type="number" value={f.wholesalePrice} onChange={setNum("wholesalePrice")} /></Field>
        <Field label="営業パートナー価格（円）" hint="空欄ならサロン卸価格と同じになります">
          <Input type="number" value={f.partnerPrice} onChange={set("partnerPrice")} placeholder="サロン卸価格と同じ" />
        </Field>
        <Field label="最低注文数"><Input type="number" value={f.minOrderQty} onChange={setNum("minOrderQty")} /></Field>
        <Field label="在庫数"><Input type="number" value={f.stock} onChange={setNum("stock")} /></Field>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <Btn disabled={uploading} onClick={() => onSave({ ...f, partnerPrice: f.partnerPrice === "" ? "" : Number(f.partnerPrice) })}>保存する</Btn>
        <Btn variant="ghost" onClick={onCancel}>キャンセル</Btn>
      </div>
    </Card>
  );
}

function AdminSettings({ bankInfo, onSave }) {
  const [f, setF] = useState(bankInfo);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <Screen maxWidth={620}>
      <SectionTitle eyebrow="ADMIN" title="設定 ・ 振込先情報" />
      <Card style={{ padding: 22 }}>
        <Field label="銀行名"><Input value={f.bankName} onChange={set("bankName")} /></Field>
        <Field label="支店名"><Input value={f.branchName} onChange={set("branchName")} /></Field>
        <Field label="口座種別"><Input value={f.accountType} onChange={set("accountType")} /></Field>
        <Field label="口座番号"><Input value={f.accountNumber} onChange={set("accountNumber")} /></Field>
        <Field label="口座名義"><Input value={f.accountHolder} onChange={set("accountHolder")} /></Field>
        <Field label="振込期限（注文から何日以内）"><Input type="number" value={f.deadlineDays} onChange={(e) => setF({ ...f, deadlineDays: Number(e.target.value) })} /></Field>
      </Card>

      <div style={{ marginTop: 24 }}>
        <SectionTitle title="領収書発行者情報" />
        <Card style={{ padding: 22 }}>
          <Field label="発行者名（屋号・会社名）" hint="領収書に「発行者」として印字されます">
            <Input value={f.issuerName} onChange={set("issuerName")} placeholder="例）よもぎの環" />
          </Field>
          <Field label="発行者住所">
            <Input value={f.issuerAddress} onChange={set("issuerAddress")} placeholder="都道府県から番地まで" />
          </Field>
        </Card>
      </div>

      <div style={{ marginTop: 24 }}>
        <Btn
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave(f);
            setSaving(false);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
        >
          {saving ? "保存中…" : "保存する"}
        </Btn>
        {saved && <span style={{ marginLeft: 12, color: C.forestSoft, fontSize: 12.5 }}>保存しました</span>}
      </div>

      <div style={{ marginTop: 30 }}>
        <SectionTitle title="今後追加予定の機能" />
        <Card style={{ padding: 18, fontSize: 12.5, color: C.inkSoft, lineHeight: 2.1 }}>
          定期仕入れ ／ クレジットカード決済 ／ 請求書発行 ／ LINE連携 ／ サロン別購入金額集計 ／
          売上ランキング ／ ポイント制度 ／ キャンペーン管理 ／ サロン向け資料・商品画像ダウンロード
        </Card>
      </div>
    </Screen>
  );
}

/* ============================================================
   ROOT APP
============================================================ */
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = not checked yet, null = signed out
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("guest"); // guest | salon-unregistered | salon-pending | salon | admin
  const [salon, setSalon] = useState(null);
  const [salons, setSalons] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [bankInfo, setBankInfo] = useState(DEFAULT_BANK);

  const [view, setViewRaw] = useState("login");
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [lastOrderId, setLastOrderId] = useState(null);
  const [receiptOrderId, setReceiptOrderId] = useState(null);
  const [cart, setCart] = useState([]);

  const setView = (v, param) => {
    if (v === "productDetail" && param) setSelectedProductId(param);
    if (v === "admin-receipt" && param) setReceiptOrderId(param);
    window.scrollTo(0, 0);
    setViewRaw(v);
  };

  // Track the Supabase auth session (covers magic-link and password sign-in).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Once we know who's signed in (or that nobody is), figure out their role
  // and load whatever data that role is allowed to see under RLS.
  useEffect(() => {
    if (session === undefined) return;
    // Guards against a stale run finishing after a newer one already
    // landed (e.g. registerSalon's signUp()+signOut() fire two auth
    // state changes in quick succession — the first run's async DB
    // lookups can otherwise resolve after the second and clobber it).
    let cancelled = false;
    (async () => {
      setLoading(true);

      if (!session) {
        if (cancelled) return;
        setRole("guest");
        setSalon(null);
        setView("login");
        setLoading(false);
        return;
      }

      const email = session.user.email;
      const { data: adminRow } = await supabase.from("admins").select("email").eq("email", email).maybeSingle();

      if (adminRow) {
        const [{ data: salonsData }, { data: ordersData }, { data: productsData }, { data: bankData }] = await Promise.all([
          supabase.from("salons").select("*").order("registered_at", { ascending: true }),
          supabase.from("orders").select("*").order("created_at", { ascending: true }),
          supabase.from("products").select("*").order("sort_order"),
          supabase.from("bank_info").select("*").maybeSingle(),
        ]);
        if (cancelled) return;
        setSalons(mapSalons(salonsData));
        setOrders(mapOrders(ordersData));
        setProducts(mapProducts(productsData));
        setBankInfo(mapBankInfo(bankData));
        setRole("admin");
        setView("admin-dashboard");
        setLoading(false);
        return;
      }

      let { data: salonRow } = await supabase.from("salons").select("*").eq("user_id", session.user.id).maybeSingle();
      if (!salonRow) {
        const { data: unclaimed } = await supabase.from("salons").select("*").eq("email", email).is("user_id", null).maybeSingle();
        if (unclaimed) {
          const { data: claimed } = await supabase
            .from("salons")
            .update({ user_id: session.user.id })
            .eq("id", unclaimed.id)
            .select()
            .maybeSingle();
          salonRow = claimed || unclaimed;
        }
      }

      if (cancelled) return;

      if (!salonRow) {
        setRole("salon-unregistered");
        setSalon(null);
        setLoading(false);
        return;
      }
      if (salonRow.status !== "approved") {
        setRole("salon-pending");
        setSalon(mapSalon(salonRow));
        setLoading(false);
        return;
      }

      const [{ data: ordersData }, { data: productsData }, { data: bankData }] = await Promise.all([
        supabase.from("orders").select("*").eq("salon_id", salonRow.id).order("created_at", { ascending: true }),
        supabase.from("products").select("*").eq("active", true).order("sort_order"),
        supabase.from("bank_info").select("*").maybeSingle(),
      ]);
      if (cancelled) return;
      setSalon(mapSalon(salonRow));
      setOrders(mapOrders(ordersData));
      setProducts(mapProducts(productsData));
      setBankInfo(mapBankInfo(bankData));
      setRole("salon");
      setView("top");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [session]);

  const selectedProduct = products.find((p) => p.id === selectedProductId) || null;
  const lastOrder = orders.find((o) => o.id === lastOrderId) || null;
  const receiptOrder = orders.find((o) => o.id === receiptOrderId) || null;
  const receiptSalon = salons.find((s) => s.id === receiptOrder?.salonId) || null;
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);

  const registerSalon = async (form) => {
    const { error: signUpErr } = await supabase.auth.signUp({
      email: form.email,
      password: SALON_SHARED_PASSWORD,
    });
    if (signUpErr) return { error: signUpErr };

    const { error } = await supabase.from("salons").insert({
      salon_name: form.salonName,
      contact_name: form.contactName,
      email: form.email,
      phone: form.phone,
      zip: form.zip,
      address: form.address,
      instagram: form.instagram,
      salon_url: form.salonUrl,
      desired_products: form.desiredProducts,
      notes: form.notes,
    });
    // signUp() logs this browser in immediately; sign back out so the guest
    // stays on the registration confirmation screen until an admin approves.
    await supabase.auth.signOut();
    return { error };
  };

  const updateSalon = async (id, patch) => {
    const dbPatch = {};
    if ("status" in patch) dbPatch.status = patch.status;
    if ("partnerAccount" in patch) dbPatch.account_type = patch.partnerAccount ? "partner" : "salon";
    await supabase.from("salons").update(dbPatch).eq("id", id);
    if ("partnerAccount" in patch) {
      // Keep the salon's login password in sync with its new category, since
      // salons and 営業パートナー each have their own shared password.
      const newPassword = patch.partnerAccount ? PARTNER_SHARED_PASSWORD : SALON_SHARED_PASSWORD;
      await supabase.rpc("admin_set_salon_password", { p_salon_id: id, p_new_password: newPassword });
    }
    const { data } = await supabase.from("salons").select("*").order("registered_at", { ascending: true });
    setSalons(mapSalons(data));
  };

  const updateProduct = async (id, patch) => {
    await supabase.from("products").update(productToDb(patch)).eq("id", id);
    const { data } = await supabase.from("products").select("*").order("sort_order");
    setProducts(mapProducts(data));
  };

  const addProduct = async (data) => {
    const maxOrder = products.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0);
    await supabase.from("products").insert({ ...productToDb(data), sort_order: maxOrder + 1 });
    const { data: rows } = await supabase.from("products").select("*").order("sort_order");
    setProducts(mapProducts(rows));
  };

  // Renumbers the whole list to the swapped order (rather than swapping the
  // two sort_order values directly) so it self-heals from ties - every
  // existing product defaults to sort_order 0 until moved at least once.
  const moveProduct = async (id, direction) => {
    const idx = products.findIndex((p) => p.id === id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= products.length) return;
    const reordered = [...products];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    await Promise.all(
      reordered.map((p, i) => supabase.from("products").update({ sort_order: i }).eq("id", p.id))
    );
    const { data } = await supabase.from("products").select("*").order("sort_order");
    setProducts(mapProducts(data));
  };

  const updateOrder = async (id, patch) => {
    await supabase.from("orders").update(orderPatchToDb(patch)).eq("id", id);
    const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: true });
    setOrders(mapOrders(data));
  };

  const cancelOrder = async (id) => {
    const { error } = await supabase.rpc("cancel_order", { p_order_id: id });
    if (error) {
      alert("キャンセルに失敗しました：" + error.message);
      return;
    }
    const [{ data: ordersData }, { data: productsData }] = await Promise.all([
      supabase.from("orders").select("*").order("created_at", { ascending: true }),
      supabase.from("products").select("*").order("sort_order"),
    ]);
    setOrders(mapOrders(ordersData));
    setProducts(mapProducts(productsData));
  };

  const saveBankInfo = async (f) => {
    await supabase
      .from("bank_info")
      .update({
        bank_name: f.bankName,
        branch_name: f.branchName,
        account_type: f.accountType,
        account_number: f.accountNumber,
        account_holder: f.accountHolder,
        deadline_days: f.deadlineDays,
        issuer_name: f.issuerName,
        issuer_address: f.issuerAddress,
      })
      .eq("id", true);
    setBankInfo(f);
  };

  const confirmOrder = async () => {
    const { items, subtotal, shipping, total } = calcCartTotals(cart, products, salon);
    const { data, error } = await supabase.rpc("place_order", {
      p_order_number: genOrderNumber(),
      p_items: items,
      p_subtotal: subtotal,
      p_shipping: shipping,
      p_total: total,
    });
    if (error) {
      alert("注文の作成に失敗しました：" + error.message);
      return;
    }
    const newOrder = mapOrder(data);
    setOrders((prev) => [...prev, newOrder]);
    const { data: productsData } = await supabase.from("products").select("*").eq("active", true).order("sort_order");
    setProducts(mapProducts(productsData));
    setCart([]);
    setLastOrderId(newOrder.id);
    setView("complete");
  };

  const doLogout = async () => {
    await supabase.auth.signOut();
    setCart([]);
  };

  const style = (
    <style>{`
      ${FONT_IMPORT}
      * { box-sizing: border-box; }
      body { margin: 0; font-family: 'Noto Sans JP', sans-serif; background: ${C.ivory}; }
      input:focus, textarea:focus, select:focus { border-color: ${C.forest} !important; }
      ::selection { background: ${C.goldSoft}; }
    `}</style>
  );

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.forest, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {style}
        <RingMark size={40} color={C.ivory} />
      </div>
    );
  }

  // GUEST FLOWS
  if (role === "guest") {
    return (
      <div style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>
        {style}
        {view === "register" ? (
          <RegisterScreen onSubmit={registerSalon} goLogin={() => setView("login")} />
        ) : (
          <LoginScreen goRegister={() => setView("register")} />
        )}
      </div>
    );
  }

  // A magic-link sign-in that doesn't match any salon registration.
  if (role === "salon-unregistered") {
    return (
      <div style={{ minHeight: "100vh", background: C.ivory, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        {style}
        <Card style={{ padding: 32, textAlign: "center", maxWidth: 400 }}>
          <AlertCircle size={32} color={C.clay} style={{ marginBottom: 14 }} />
          <div style={{ fontFamily: "'Shippori Mincho', serif", fontSize: 18, marginBottom: 10 }}>登録が見つかりません</div>
          <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.8, marginBottom: 24 }}>
            このメールアドレスでの取扱店登録が見つかりませんでした。取扱店登録からお申し込みください。
          </div>
          <Btn full onClick={doLogout}>ログアウト</Btn>
        </Card>
      </div>
    );
  }

  // Registered but not yet approved by the operator.
  if (role === "salon-pending") {
    return (
      <div style={{ minHeight: "100vh", background: C.ivory, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        {style}
        <Card style={{ padding: 32, textAlign: "center", maxWidth: 400 }}>
          <Clock size={32} color={C.gold} style={{ marginBottom: 14 }} />
          <div style={{ fontFamily: "'Shippori Mincho', serif", fontSize: 18, marginBottom: 10 }}>承認をお待ちください</div>
          <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.8, marginBottom: 24 }}>
            ご登録ありがとうございます。現在、運営者による承認をお待ちいただいております。
          </div>
          <Btn full onClick={doLogout}>ログアウト</Btn>
        </Card>
      </div>
    );
  }

  // ADMIN FLOW
  if (role === "admin") {
    return (
      <div style={{ minHeight: "100vh", background: C.ivory, fontFamily: "'Noto Sans JP', sans-serif" }}>
        {style}
        <div className="print-hide">
          <TopBar admin onLogout={doLogout} view={view} setView={setView} />
          <AdminNav view={view} setView={setView} />
        </div>
        {view === "admin-dashboard" && <AdminDashboard salons={salons} orders={orders} products={products} setView={setView} />}
        {view === "admin-salons" && <AdminSalons salons={salons} updateSalon={updateSalon} />}
        {view === "admin-orders" && <AdminOrders orders={orders} salons={salons} updateOrder={updateOrder} cancelOrder={cancelOrder} setView={setView} />}
        {view === "admin-products" && <AdminProducts products={products} updateProduct={updateProduct} addProduct={addProduct} moveProduct={moveProduct} />}
        {view === "admin-settings" && <AdminSettings bankInfo={bankInfo} onSave={saveBankInfo} />}
        {view === "admin-receipt" && <ReceiptScreen order={receiptOrder} salon={receiptSalon} bankInfo={bankInfo} setView={setView} />}
      </div>
    );
  }

  // SALON FLOW
  if (!salon) { doLogout(); return null; }
  return (
    <div style={{ minHeight: "100vh", background: C.ivory, fontFamily: "'Noto Sans JP', sans-serif", display: "flex", flexDirection: "column" }}>
      {style}
      <TopBar salon onLogout={doLogout} cartCount={cartCount} view={view} setView={setView} />
      <div style={{ flex: 1 }}>
        {view === "top" && <TopPage salon={salon} products={products} orders={orders} setView={setView} />}
        {view === "products" && <ProductListScreen products={products} cart={cart} setCart={setCart} salon={salon} setView={setView} />}
        {view === "productDetail" && <ProductDetailScreen product={selectedProduct} setCart={setCart} salon={salon} setView={setView} />}
        {view === "cart" && <CartScreen cart={cart} setCart={setCart} products={products} salon={salon} setView={setView} />}
        {view === "checkout" && <CheckoutScreen salon={salon} cart={cart} products={products} bankInfo={bankInfo} onConfirm={confirmOrder} setView={setView} />}
        {view === "complete" && <CompleteScreen order={lastOrder} bankInfo={bankInfo} setView={setView} />}
        {view === "mypage" && <MyPageScreen salon={salon} orders={orders} setView={setView} />}
        {view === "orderHistory" && <OrderHistoryScreen salon={salon} orders={orders} setView={setView} />}
      </div>
      <BottomNav view={view} setView={setView} />
    </div>
  );
}
