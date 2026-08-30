import React, { useState } from "react";
import { Me } from "../types";

/**
 * Who you are, and what that lets you do.
 *
 * Access control the user cannot see is access control they will trip over. This
 * states the role, what it is scoped to, and — in demo mode — lets a reviewer
 * switch roles to watch the rules take effect, which is the only honest way to
 * show an access model without handing out three real accounts.
 */
export default function Identity({ me, onSwitch }: {
  me: Me | null; onSwitch: (role: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!me) return null;

  const demo = !me.authenticated;
  return (
    <div className={`idchip ${open ? "open" : ""}`}>
      <button className="idchip-btn" onClick={() => setOpen((v) => !v)}
        title={me.email || "not signed in"}>
        <span className={`idrole ${me.role}`}>{me.role}</span>
        <span className="idname">{me.name}</span>
        {me.district_id != null && <span className="iddist">district {me.district_id}</span>}
        {demo && <span className="iddemo">demo</span>}
      </button>

      {open && (
        <div className="idpop">
          <div className="idpop-h">Access</div>
          <div className="idpop-src">
            {me.authenticated
              ? <>Signed in via <b>Catalyst Authentication</b>{me.email && <> as {me.email}</>}.</>
              : <>No signed-in user. The gateway is in <b>{me.auth_mode}</b> mode, so it is
                  serving the <b>{me.role}</b> role. Setting <code>CLINK_AUTH_MODE=enforced</code>
                  requires a real Catalyst account and this switcher stops working.</>}
          </div>

          <div className="idpop-h">This role can</div>
          <ul className="idperms">
            {me.permissions.map((p) => <li key={p}><code>{p}</code></li>)}
          </ul>

          {demo && (
            <>
              <div className="idpop-h">View as</div>
              <div className="idroles">
                {me.roles.map((r) => (
                  <button key={r} className={r === me.role ? "on" : ""}
                    onClick={() => { onSwitch(r); setOpen(false); }}>{r}</button>
                ))}
              </div>
              <div className="idpop-note">
                Switching re-fetches every panel through the gateway, so what you see
                is what that role is actually served — not a hidden menu item.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
