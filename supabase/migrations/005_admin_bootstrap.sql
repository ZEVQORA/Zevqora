-- Bootstrap the internal admin panel with the two founding accounts already
-- present in auth.users. Further admins are granted from the admin panel and
-- every grant is written to admin_audit_log.
insert into public.admin_roles (user_id, role)
select id, 'superadmin' from auth.users where lower(email) in ('bayarbayasgalan.bb@gmail.com', 'xvslen1116@gmail.com')
on conflict (user_id) do nothing;
