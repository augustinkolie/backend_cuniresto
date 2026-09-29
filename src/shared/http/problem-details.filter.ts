import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { Request, Response } from 'express'
import { DomainError } from '../domain/domain-error'

interface ProblemDetails {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  errors?: string[]
}

/** Toutes les erreurs sortent au format RFC 9457 (application/problem+json). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const req = http.getRequest<Request>()
    const res = http.getResponse<Response>()
    const problem = this.toProblem(exception, req.originalUrl)

    if (problem.status >= 500) this.logger.error(exception)
    res.status(problem.status).type('application/problem+json').json(problem)
  }

  private toProblem(exception: unknown, instance: string): ProblemDetails {
    if (exception instanceof DomainError) {
      return this.build(exception.status, exception.code, exception.message, instance)
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const body = exception.getResponse()
      const messages =
        typeof body === 'object' && body !== null && 'message' in body
          ? (body as { message: string | string[] }).message
          : exception.message
      const errors = Array.isArray(messages) ? messages : undefined
      const detail = Array.isArray(messages) ? 'Données invalides' : messages
      return { ...this.build(status, slug(status), detail, instance), errors }
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return this.build(409, 'conflict', 'Cette ressource existe déjà', instance)
      }
      if (exception.code === 'P2025') {
        return this.build(404, 'not-found', 'Ressource introuvable', instance)
      }
    }

    return this.build(500, 'internal-error', 'Erreur interne du serveur', instance)
  }

  private build(status: number, code: string, detail: string, instance: string): ProblemDetails {
    return {
      type: `https://maisonbraise.gn/problems/${code}`,
      title: HttpStatus[status]?.replace(/_/g, ' ').toLowerCase() ?? 'error',
      status,
      detail,
      instance,
    }
  }
}

function slug(status: number): string {
  return (HttpStatus[status] ?? 'error').toLowerCase().replace(/_/g, '-')
}
