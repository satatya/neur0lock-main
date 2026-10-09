import { Request, RequestHandler } from 'express';
import { aaaCall, aaaUnavailable } from '../infra/aaa-client';
import { asyncHandler } from '../utils/http';

type Target = string | ((req: Request) => string);

interface ProxyOptions {
    /** Post-process `data` of a successful response (e.g. sync the directory mirror). */
    after?: (data: any, req: Request) => Promise<any> | any;
}

export const param = (req: Request, name: string) => encodeURIComponent(String(req.params[name] ?? ''));

/**
 * Forwards the request to the AAA server (with the user's bearer/step-up token and client details)
 * and relays its status and JSON body. The AAA server performs the authorization checks for these
 * identity and administration endpoints.
 */
export function proxy(method: 'GET' | 'POST' | 'PUT' | 'DELETE', target: Target, options: ProxyOptions = {}): RequestHandler {
    return asyncHandler(async (req, res) => {
        const path = typeof target === 'function' ? target(req) : target;
        const hasBody = method === 'POST' || method === 'PUT';
        let response;
        try {
            response = await aaaCall(method, path, { req, body: hasBody ? req.body ?? {} : undefined, query: req.query as Record<string, unknown> });
        } catch (error) {
            throw aaaUnavailable(error);
        }
        let body = response.body;
        if (response.status < 400 && options.after) {
            body = { ...body, data: await options.after(body.data, req) };
        }
        res.status(response.status).json(body);
    });
}
