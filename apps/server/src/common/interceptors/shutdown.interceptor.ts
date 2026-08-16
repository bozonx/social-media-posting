import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { ShutdownService } from '../services/shutdown.service.js';

/**
 * Interceptor that rejects new requests during shutdown
 * and tracks in-flight requests for graceful shutdown
 */
@Injectable()
export class ShutdownInterceptor implements NestInterceptor {
  constructor(private readonly shutdownService: ShutdownService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const isHealth =
      (context as Partial<ExecutionContext>).getClass?.().name === 'HealthController';
    if (isHealth) {
      return next.handle();
    }
    if (this.shutdownService.shuttingDown) {
      throw new ServiceUnavailableException('Server is shutting down');
    }

    this.shutdownService.trackRequest();

    return next.handle().pipe(
      tap(() => {
        this.shutdownService.untrackRequest();
      }),
      catchError(err => {
        this.shutdownService.untrackRequest();
        return throwError(() => err);
      }),
    );
  }
}
