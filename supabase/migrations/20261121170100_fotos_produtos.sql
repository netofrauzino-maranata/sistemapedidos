-- Bucket público para fotos de produtos (usadas no app e no catálogo).
-- Leitura pública; só o gestor envia, troca ou apaga.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produtos', 'produtos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "produtos_fotos_gestor_insere" on storage.objects for insert to authenticated
  with check (bucket_id = 'produtos' and public.eh_gestor());
create policy "produtos_fotos_gestor_altera" on storage.objects for update to authenticated
  using (bucket_id = 'produtos' and public.eh_gestor());
create policy "produtos_fotos_gestor_apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'produtos' and public.eh_gestor());
