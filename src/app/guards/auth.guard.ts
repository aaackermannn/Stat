import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, authState } from '@angular/fire/auth';
import { map, take, switchMap } from 'rxjs/operators';
import { UserProfileService } from '../services/user-profile.service';
import { of } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const auth = inject(Auth);

  return authState(auth).pipe(
    take(1),
    map((user) => (user ? true : router.createUrlTree(['/search'])))
  );
};

export const faceitGuard: CanActivateFn = () => {
  const router = inject(Router);
  const auth = inject(Auth);
  const userProfileService = inject(UserProfileService);

  return authState(auth).pipe(
    take(1),
    switchMap((user) => {
      if (!user) {
        return of(router.createUrlTree(['/search']));
      }

      return userProfileService.watchProfile().pipe(
        take(1),
        map((profile) => {
          if (profile?.faceitId) {
            return true;
          } else {
            return router.createUrlTree(['/account']);
          }
        })
      );
    })
  );
};
