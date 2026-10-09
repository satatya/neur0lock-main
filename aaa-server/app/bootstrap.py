"""Idempotent directory bootstrap: OUs, permission catalog, default roles and demo accounts."""
from . import catalog
from .security import now_iso


def bootstrap(service) -> dict:
    directory, store, config = service.directory, service.store, service.config
    directory.ensure_structure()

    created_permissions = [
        code for code, category, label, _ in catalog.PERMISSIONS if directory.ensure_permission(code, category, label)
    ]

    existing_roles = {role["name"] for role in directory.list_roles()}
    created_roles = []
    if not existing_roles:
        for name, spec in catalog.DEFAULT_ROLES.items():
            directory.create_role(name, spec["display_name"], spec["description"], spec["flags"])
            for code in spec["permissions"]:
                directory.grant(name, code)
            created_roles.append(name)
    elif created_permissions:
        # New permission codes added in a later version: grant them to the built-in roles that
        # have them by default, so upgrades behave like a fresh install.
        for name, spec in catalog.DEFAULT_ROLES.items():
            if name in existing_roles:
                for code in created_permissions:
                    if code in spec["permissions"]:
                        directory.grant(name, code)

    created_users = []
    if config.SEED_DEMO:
        for demo in catalog.DEMO_USERS:
            if directory.get_user(demo["uid"]):
                continue
            directory.create_user(demo["uid"], demo["name"], demo["email"], config.DEMO_PASSWORD, phone=demo["phone"], title=catalog.DEFAULT_ROLES[demo["role"]]["display_name"])
            directory.set_user_role(demo["uid"], demo["role"])
            store.execute(
                "INSERT OR IGNORE INTO accounts (uid, kind, status, created_at, password_changed_at) VALUES (?, ?, 'active', ?, ?)",
                (demo["uid"], "patient" if demo["role"] == "patient" else "staff", now_iso(), now_iso()),
            )
            created_users.append(demo["uid"])

    service.bump_rbac()
    return {"permissions": created_permissions, "roles": created_roles, "users": created_users}
