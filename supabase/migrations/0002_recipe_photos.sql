-- Phase 2: a private bucket for photos of dishes you've cooked, uploaded directly from the
-- browser. Paste into Supabase → SQL Editor and run once, after 0001_init.sql.
--
-- Objects are stored at "<household_id>/<recipe_id>/<uuid>.<ext>"; the policies below scope
-- access to the uploader's household by checking that path's first folder segment.

insert into storage.buckets (id, name, public)
values ('recipe-photos', 'recipe-photos', false)
on conflict (id) do nothing;

create policy recipe_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recipe-photos'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );

create policy recipe_photos_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'recipe-photos'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  )
  with check (
    bucket_id = 'recipe-photos'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );
