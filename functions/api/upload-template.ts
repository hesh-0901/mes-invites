interface CloudinaryEnv {
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }: { request: Request; env: CloudinaryEnv }): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  try {
    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
      return Response.json({ error: 'La configuration Cloudinary est incomplète côté serveur.' }, { status: 500, headers: corsHeaders });
    }
    const incoming = await request.formData();
    const file = incoming.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'Aucun fichier image reçu.' }, { status: 400, headers: corsHeaders });
    }
    const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
    if (!allowedTypes.has(file.type)) {
      return Response.json({ error: 'Formats acceptés : PNG, JPG et WebP.' }, { status: 415, headers: corsHeaders });
    }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
      return Response.json({ error: 'Le fichier doit peser moins de 10 Mo.' }, { status: 413, headers: corsHeaders });
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder = 'mes-invites';
    const signaturePayload = `folder=${folder}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
    const signature = toHex(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(signaturePayload)));
    const cloudinaryForm = new FormData();
    cloudinaryForm.append('file', file, file.name);
    cloudinaryForm.append('api_key', env.CLOUDINARY_API_KEY);
    cloudinaryForm.append('timestamp', timestamp);
    cloudinaryForm.append('folder', folder);
    cloudinaryForm.append('signature', signature);

    const uploadResponse = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(env.CLOUDINARY_CLOUD_NAME)}/image/upload`, {
      method: 'POST',
      body: cloudinaryForm,
    });
    const uploadResult = await uploadResponse.json() as { secure_url?: string; public_id?: string; error?: { message?: string } };
    if (!uploadResponse.ok || !uploadResult.secure_url) {
      return Response.json({ error: uploadResult.error?.message ?? 'Cloudinary a refusé le téléversement.' }, { status: 502, headers: corsHeaders });
    }
    return Response.json({ secure_url: uploadResult.secure_url, public_id: uploadResult.public_id }, { headers: corsHeaders });
  } catch {
    return Response.json({ error: 'Erreur pendant le téléversement du template.' }, { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions({ request }: { request: Request }): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    },
  });
}
