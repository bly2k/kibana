define([
  'angular',
  'app',
  'underscore',
  'jquery',
  'kbn'
],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.stats', []);
  app.useModule(module);

  module.controller('stats', function($scope, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      status: "Stable",
      description: "Displays a statistical aggregration (count, total, avg, max, min, terms/distinct count) of a numeric field."
    };

    var _d = {
      queries: {
        mode: 'all',
        ids: [],
        queryString: ""
      },
      field: "",
      statistic: "count",
      decimals: 0,
      decimalSeparator: ".",
      commaSeparator: ",",
      termsCountMax: 100000,
      style: {},
      formatString: "{0}",
      spyable : true,
      valueScript: null
    };

    _.defaults($scope.panel, _d);

    $scope.set_refresh = function (state)
    {
      $scope.refresh = state;
    };

    $scope.close_edit = function ()
    {
      if ($scope.refresh)
      {
        $scope.get_data();
      }
      $scope.refresh = false;
      $scope.$emit('render');
    };

    $scope.init = function ()
    {
      $scope.$on('render', function ()
      {
        $scope.$apply();
      });
      $scope.$on('refresh', function ()
      {
        $scope.get_data();
      });
      $scope.get_data();
    };

    $scope.get_data = function (segment, query_id)
    {
      delete $scope.panel.error;

      // Make sure we have everything for the request to complete
      if (dashboard.indices.length === 0) {
        return;
      }

      if ($scope.panel.statistic != "hits" && ($scope.panel.field == null || $scope.panel.field == "")) {
        $scope.panel.error = "Field must be specified.";
        return null;
      }

      $scope.panelMeta.loading = true;

      var request = $scope.ejs.Request().indices(dashboard.indices);

      var fq = querySrv.getFacetQuery(filterSrv, $scope.panel.queries, $scope.panel.queries.queryString);
      request = request.query(fq);

      var mode = $scope.panel.statistic;

      switch (mode)
      {
        case "count":
          request = request
            .facet($scope.ejs.QueryFacet('stats')
              .query($scope.ejs.QueryStringQuery($scope.panel.field + ":*"))
              ).size(0);
          break;

        case "termscount":
          request = request
           .facet($scope.ejs.TermsFacet('terms')
            .field($scope.panel.field)
            .size($scope.panel.termsCountMax)).size(0);
          break;

        case "hits":
          request = request.searchType("count").size(0);
          break;

        default:
          var facet = $scope.ejs.StatisticalFacet('stats');

          if ($scope.panel.valueScript != null && $scope.panel.valueScript != "")
            facet = facet.script($scope.panel.valueScript);
          else
            facet = facet.field($scope.panel.field);

          request = request.facet(facet).size(0);

          break;
      }

      // Populate the inspector panel
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);

      var results = request.doSearch();

      results.then(function (results) {
        $scope.panelMeta.loading = false;
        $scope.hits = results.hits.total;

        require(['jquery.number'], function() {
          var statistic = 0;

          switch (mode)
          {
            case "termscount":
              statistic = results.facets.terms.terms.length;
              break;

            case "count":
              statistic = results.facets.stats.count;
              break;

            case "hits":
              statistic = results.hits.total;
              break;

            default:
              statistic = results.facets.stats[mode];
              break;
          }

          var formatted = $.number(statistic, $scope.panel.decimals, $scope.panel.decimalSeparator, $scope.panel.commaSeparator);
          if (!_.isUndefined($scope.panel.formatString) && $scope.panel.formatString != null && $scope.panel.formatString != "")
            formatted = $scope.panel.formatString.replace(/\{0\}/g, formatted);

          $scope.statistic = formatted;

          $scope.$emit('render');
        });
      });
    };
  });
});