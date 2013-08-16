/*jshint globalstrict:true */
/*global angular:true */
'use strict';

angular.module('kibana.directives', [])
.directive('kibanaPanel', function($compile) {
  return {
    restrict: 'E',
    controller: function ($scope) {
      $scope.movePanelVertical = function(row, rowIndex, panel, panelIndex, direction) {
        //compute current span location
        var panelPreSpan = 0;
        for (var p = 0; p < panelIndex; p++) panelPreSpan += row.panels[p].span;

        //compute destination row possible index
        var destRow = $scope.dashboard.current.rows[rowIndex + direction];
        var destPanelIndex = -1, destPanelSpan = 0;
        for (var p = 0; p < destRow.panels.length; p++) {
          destPanelSpan += destRow.panels[p].span;
          if (destPanelSpan > panelPreSpan) {
            destPanelIndex = p;
            break;
          }
        }

        //copy
        if (destPanelIndex >= 0 && destRow.panels.length > destPanelIndex)
          destRow.panels.splice(destPanelIndex, 0, panel);
        else
          destRow.panels.push(panel);

        //relocate
        row.panels = _.without(row.panels,panel); 
      };

      $scope.rowScope = function()
      {
        return $scope.$parent.$parent.$parent;
      }
    },
    link: function(scope, elem, attrs) {
      var template = '<i class="icon-spinner small icon-spin icon-large panel-loading" '+
        'ng-show="panelMeta.loading == true && !panel.title"></i>'+
        '<span class="editlink panelextra pointer" style="right:20px;top:0px" ng-show="panel.editable != false">'+
        '<i ng-show="!$first" class="pointer link icon-caret-left" ng-click="_.move(row.panels,$index,$index-1)"></i>' +
        '<i style="margin-left:5px" ng-click="movePanelVertical(row, rowScope().$index, panel, $index, +1); " ng-hide="rowScope().$last" class="pointer icon-arrow-down"></i>' +
        '<i style="margin-left:5px" ng-click="movePanelVertical(row, rowScope().$index, panel, $index, -1); " ng-hide="rowScope().$first" class="pointer icon-arrow-up"></i>' +
        '<i style="margin-left:5px" ng-show="!$last" class="pointer link icon-caret-right" ng-click="_.move(row.panels,$index,$index+1)"></i>' +
        '&nbsp;&nbsp;|&nbsp;&nbsp;' +
        '<span bs-modal="\'partials/paneleditor.html\'">' + 
        '<span class="small">{{panel.type}}</span> <i class="icon-cog pointer"></i> ' +
        '</span>' +
        '</span><h4>'+
        '{{panel.title}} '+
        '<i class="icon-spinner smaller icon-spin icon-large" ng-show="panelMeta.loading == true && panel.title"></i>'+
        '</h4>';

      elem.prepend($compile(angular.element(template))(scope));
    }
  };
})
.directive('addPanel', function($compile) {
  return {
    restrict: 'A',
    link: function(scope, elem, attrs) {
      scope.$watch('panel.type', function(n,o) {
        if(!_.isUndefined(scope.panel.type)) {
          var template = '<div>'+
          '<div ng-controller="'+scope.panel.type+'" ng-include src="\'partials/panelgeneral.html\'"></div>'+
          '<div ng-controller="'+scope.panel.type+'" ng-include src="\''+scope.edit_path(scope.panel.type)+'\'">'+
          '</div>';
          elem.html($compile(angular.element(template))(scope));
        }
      });
    }
  };
})
.directive('arrayJoin', function() {
  return {
    restrict: 'A',
    require: 'ngModel',
    link: function(scope, element, attr, ngModel) {

      function split_array(text) {
        return (text || '').split(',');
      }

      function join_array(text) {
        if(_.isArray(text)) {
          return (text || '').join(',');
        } else {
          return text;
        }
      }

      ngModel.$parsers.push(split_array);
      ngModel.$formatters.push(join_array);
    }
  };
})
.directive('ngModelOnblur', function() {
  return {
    restrict: 'A',
    require: 'ngModel',
    link: function(scope, elm, attr, ngModelCtrl) {
      if (attr.type === 'radio' || attr.type === 'checkbox') {
        return;
      }

      elm.unbind('input').unbind('keydown').unbind('change');
      elm.bind('blur', function() {
        scope.$apply(function() {
          ngModelCtrl.$setViewValue(elm.val());
        });         
      });
    }
  };
})
.directive('ngBlur', ['$parse', function($parse) {
  return function(scope, element, attr) {
    var fn = $parse(attr['ngBlur']);
    element.bind('blur', function(event) {
      scope.$apply(function() {
        fn(scope, {$event:event});
      });
    });
  };
}]);

