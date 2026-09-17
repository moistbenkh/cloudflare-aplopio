// TEMPORARY — GET /api/admin/debug-env?key=YOUR_ADMIN_KEY
// Reports which env bindings/secrets this specific live deployment can see,
// without ever revealing their values. Exists only to answer one question:
// "is ACCESS_SECRET actually present in the environment this request is
// running in?" Delete this file once that's answered.

function isAdmin(request, env) {
  const url = new URL(request.url);
  const headerKey = request.headers.get('X-Admin-Key') || '';
  const queryKey = url.searchParams.get('key') || '';
  return !!env.ADMIN_KEY && (headerKey === env.ADMIN_KEY || queryKey === env.ADMIN_KEY);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!isAdmin(request, env)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  return Response.json({
    deployment_env_vars_present: {
      ACCESS_SECRET: !!env.ACCESS_SECRET,
      ADMIN_KEY: !!env.ADMIN_KEY,
      PING_SECRET: !!env.PING_SECRET,
      RESEND_API_KEY: !!env.RESEND_API_KEY,
      FROM_EMAIL: !!env.FROM_EMAIL,
      SITE_ORIGIN: !!env.SITE_ORIGIN,
    },
    bindings_present: {
      DB: !!env.DB,
      SAMPLES_BUCKET: !!env.SAMPLES_BUCKET,
    },
    // Helps confirm you're hitting the deployment you think you are.
    cf_ray: request.headers.get('cf-ray') || null,
    url: request.url,
    timestamp: new Date().toISOString(),
  });
}
